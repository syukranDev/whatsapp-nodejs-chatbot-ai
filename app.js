const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

dotenv.config();

const app = express();
app.use(express.json());

const logger = {
  info: (message) => console.log(`INFO: ${new Date().toISOString()} - ${message}`),
  warning: (message) => console.log(`WARNING: ${new Date().toISOString()} - ${message}`),
  error: (message, error = null) => {
    console.error(`ERROR: ${new Date().toISOString()} - ${message}`);
    if (error) console.error(error);
  }
};

const CONVERSATIONS_DIR = 'conversations';
if (!fs.existsSync(CONVERSATIONS_DIR)) {
  fs.mkdirSync(CONVERSATIONS_DIR);
  logger.info(`Created conversations directory at ${CONVERSATIONS_DIR}`);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WASENDER_API_TOKEN = process.env.WASENDER_API_TOKEN;
const WASENDER_API_URL = "https://wasenderapi.com/api/send-message";

let genAI = null;
if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
} else {
  logger.error("GEMINI_API_KEY not found in environment variables. The application might not work correctly.");
}

const PERSONA_FILE_PATH = 'persona.json';
let PERSONA_DESCRIPTION = "You are a helpful assistant."; // Default persona
let PERSONA_NAME = "Assistant";
let BASE_PROMPT = "You are a helpful and concise AI assistant replying in a WhatsApp chat. Do not use Markdown formatting. Keep your answers short, friendly, and easy to read. If your response is longer than 3 lines, split it into multiple messages using \\n every 3 lines. Each \\n means a new WhatsApp message. Avoid long paragraphs or unnecessary explanations.";

try {
  const personaData = JSON.parse(fs.readFileSync(PERSONA_FILE_PATH, 'utf8'));
  const customDescription = personaData.description || PERSONA_DESCRIPTION;
  const basePrompt = personaData.base_prompt || BASE_PROMPT;
  PERSONA_DESCRIPTION = `${basePrompt}\n\n${customDescription}`;
  PERSONA_NAME = personaData.name || PERSONA_NAME;
  logger.info(`Successfully loaded persona: ${PERSONA_NAME}`);
} catch (error) {
  if (error.code === 'ENOENT') {
    logger.warning(`Persona file not found at ${PERSONA_FILE_PATH}. Using default persona.`);
  } else if (error instanceof SyntaxError) {
    logger.error(`Error decoding JSON from ${PERSONA_FILE_PATH}. Using default persona.`);
  } else {
    logger.error(`An unexpected error occurred while loading persona: ${error}. Using default persona.`);
  }
}

/**
 * Load conversation history for a given user_id
 * @param {string} userId - The user ID
 * @returns {Array} - The conversation history
 */
function loadConversationHistory(userId) {
  const filePath = path.join(CONVERSATIONS_DIR, `${userId}.json`);
  try {
    const history = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(history) && history.every(item => 
      typeof item === 'object' && 'role' in item && 'parts' in item)) {
      return history;
    } else {
      logger.warning(`Invalid history format in ${filePath}. Starting fresh.`);
      return [];
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    } else if (error instanceof SyntaxError) {
      logger.error(`Error decoding JSON from ${filePath}. Starting fresh.`);
      return [];
    } else {
      logger.error(`Unexpected error loading history from ${filePath}: ${error}`);
      return [];
    }
  }
}

/**
 * Save conversation history for a given user_id
 * @param {string} userId - The user ID
 * @param {Array} history - The conversation history to save
 */
function saveConversationHistory(userId, history) {
  const filePath = path.join(CONVERSATIONS_DIR, `${userId}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
  } catch (error) {
    logger.error(`Error saving conversation history to ${filePath}: ${error}`);
  }
}

/**
 * Split a long message into smaller chunks for better WhatsApp readability
 * @param {string} text - The text to split
 * @param {number} maxLines - Maximum number of lines per chunk
 * @param {number} maxCharsPerLine - Maximum characters per line
 * @returns {Array} - Array of message chunks
 */

function splitMessage(text, maxLines = 3, maxCharsPerLine = 100) {
  const paragraphs = text.split('\\n');
  const chunks = [];
  let currentChunk = [];
  let currentLineCount = 0;
  
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharsPerLine) {
      const words = paragraph.split(' ');
      let currentLine = [];
      let currentLength = 0;
      
      for (const word of words) {
        if (currentLength + word.length + 1 <= maxCharsPerLine) {
          currentLine.push(word);
          currentLength += word.length + 1;
        } else {
          if (currentLineCount >= maxLines) {
            chunks.push(currentChunk.join('\n'));
            currentChunk = [];
            currentLineCount = 0;
          }
          currentChunk.push(currentLine.join(' '));
          currentLineCount++;
          currentLine = [word];
          currentLength = word.length;
        }
      }
      
      if (currentLine.length) {
        if (currentLineCount >= maxLines) {
          chunks.push(currentChunk.join('\n'));
          currentChunk = [];
          currentLineCount = 0;
        }
        currentChunk.push(currentLine.join(' '));
        currentLineCount++;
      }
    } else {
      if (currentLineCount >= maxLines) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [];
        currentLineCount = 0;
      }
      currentChunk.push(paragraph);
      currentLineCount++;
    }
  }
  
  if (currentChunk.length) {
    chunks.push(currentChunk.join('\n'));
  }
  
  return chunks;
}

/**
 * Generate a response from Gemini AI
 * @param {string} messageText - The user's message
 * @param {Array} conversationHistory - The conversation history
 * @returns {Promise<string>} - The AI's response
 */
async function getGeminiResponse(messageText, conversationHistory = null) {
  if (!GEMINI_API_KEY) {
    logger.error("Gemini API key is not configured.");
    return "Sorry, I'm having trouble connecting to my brain right now (API key issue).";
  }

  try {
    const modelName = 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({ model: modelName });
    
    logger.info(`Sending prompt to Gemini (system persona active): ${messageText.substring(0, 200)}...`);

    let response;
    
    const generationConfig = {
      temperature: 0.7,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    };
    
    const systemInstruction = { role: "system", parts: [{ text: PERSONA_DESCRIPTION }] };
    
    if (conversationHistory && conversationHistory.length > 0) {
      const chat = model.startChat({
        generationConfig,
        history: conversationHistory,
        systemInstruction,
      });
      
      response = await chat.sendMessage(messageText);
      console.log('========================================================= 1')
    } else {
      const chat = model.startChat({
        generationConfig,
        systemInstruction,
      });
      
      response = await chat.sendMessage(messageText);
      console.log('========================================================= 2')
    }

    console.log('========================================================= 3')
    console.log(response)
    // notedev: refer my note for the gemini response structure
    if (response && response.response && response.response.candidates && 
        response.response.candidates.length > 0 && 
        response.response.candidates[0].content && 
        response.response.candidates[0].content.parts && 
        response.response.candidates[0].content.parts.length > 0) {
      
      return response.response.candidates[0].content.parts[0].text.trim();
    } 
    // notedev: use this fallback to checking other possible structures
    else if (response && response.text) {
      return response.text.trim();
    } else if (response && response.candidates && response.candidates.length > 0 &&
               response.candidates[0].content && response.candidates[0].content.parts) {
      return response.candidates[0].content.parts[0].text.trim();
    }
    
    logger.error(`Gemini API returned an unrecognized response structure: ${JSON.stringify(response)}`);
    return "I received an unexpected response format from Gemini. Please try again.";
  } catch (error) {
    logger.error(`Error calling Gemini API: ${error}`, error);
    return "I'm having trouble processing that request with my AI brain. Please try again later.";
  }
}

/**
 * Send a message via WaSenderAPI
 * @param {string} recipientNumber - The recipient's phone number
 * @param {string} messageContent - The message content
 * @param {string} messageType - The message type (text, image, video, audio, document)
 * @param {string} mediaUrl - The media URL (for non-text messages)
 * @returns {Promise<boolean>} - Success or failure
 */

async function sendWhatsappMessage(recipientNumber, messageContent, messageType = 'text', mediaUrl = null) {
  if (!WASENDER_API_TOKEN) {
    logger.error("WaSender API token is not set. Please check .env file.");
    return false;
  }

  const headers = {
    'Authorization': `Bearer ${WASENDER_API_TOKEN}`,
    'Content-Type': 'application/json'
  };
  
  let formattedRecipientNumber = recipientNumber;
  if (recipientNumber && recipientNumber.includes('@s.whatsapp.net')) {
    formattedRecipientNumber = recipientNumber.split('@')[0];
  }

  const payload = {
    to: formattedRecipientNumber
  };

  if (messageType === 'text') {
    payload.text = messageContent;
  } else if (messageType === 'image' && mediaUrl) {
    payload.imageUrl = mediaUrl;
    if (messageContent) {
      payload.text = messageContent;
    }
  } else if (messageType === 'video' && mediaUrl) {
    payload.videoUrl = mediaUrl;
    if (messageContent) {
      payload.text = messageContent;
    }
  } else if (messageType === 'audio' && mediaUrl) {
    payload.audioUrl = mediaUrl;
  } else if (messageType === 'document' && mediaUrl) {
    payload.documentUrl = mediaUrl;
    if (messageContent) {
      payload.text = messageContent;
    }
  } else {
    if (messageType !== 'text') {
      logger.error(`Media URL is required for message type '${messageType}'.`);
      return false;
    }
    logger.error(`Unsupported message type or missing content/media_url: ${messageType}`);
    return false;
  }
  
  logger.info(`Attempting to send WhatsApp message. Payload: ${JSON.stringify(payload)}`);

  try {
    const response = await axios.post(WASENDER_API_URL, payload, { 
      headers, 
      timeout: 20000 
    });
    
    logger.info(`Message sent to ${recipientNumber}. Response: ${JSON.stringify(response.data)}`);
    return true;
  } catch (error) {
    const statusCode = error.response ? error.response.status : 'N/A';
    const responseText = error.response ? error.response.data : 'N/A';
    
    logger.error(`Error sending WhatsApp message to ${recipientNumber} (Status: ${statusCode}): ${error}. Response: ${JSON.stringify(responseText)}`);
    
    if (statusCode === 422) {
      logger.error("WaSenderAPI 422 Error: This often means an issue with the payload (e.g., device_id, 'to' format, or message content/URL). Check the payload logged above and WaSenderAPI docs.");
    }
    return false;
  }
}

app.use((err, req, res, next) => {
  logger.error(`Unhandled Exception: ${err}`, err);
  res.status(500).json({ status: 'error', message: 'An internal server error occurred.' });
});

app.post('/webhook', async (req, res) => {
  const data = req.body;
  logger.info(`Received webhook data (first 200 chars): ${JSON.stringify(data).substring(0, 200)}`);

  try {
    if (data.event === 'messages.upsert' && data.data && data.data.messages) {
      const messageInfo = data.data.messages;
      
      if (messageInfo.key && messageInfo.key.fromMe) {
        logger.info(`Ignoring self-sent message: ${messageInfo.key.id}`);
        return res.status(200).json({ status: 'success', message: 'Self-sent message ignored' });
      }

      const senderNumber = messageInfo.key ? messageInfo.key.remoteJid : null;
      
      let incomingMessageText = null;
      let messageType = 'unknown';

      if (messageInfo.message) {
        const msgContentObj = messageInfo.message;
        if (msgContentObj.conversation) {
          incomingMessageText = msgContentObj.conversation;
          messageType = 'text';
        } else if (msgContentObj.extendedTextMessage && msgContentObj.extendedTextMessage.text) {
          incomingMessageText = msgContentObj.extendedTextMessage.text;
          messageType = 'text';
        }
      }

      if (messageInfo.messageStubType) {
        const stubParams = messageInfo.messageStubParameters || [];
        logger.info(`Received system message of type ${messageInfo.messageStubType} from ${senderNumber}. Stub params: ${stubParams}`);
        return res.status(200).json({ status: 'success', message: 'System message processed' });
      }

      if (!senderNumber) {
        logger.warning("Webhook received message without sender information.");
        return res.status(400).json({ status: 'error', message: 'Incomplete sender data' });
      }

      const safeSenderId = senderNumber.replace(/[^a-zA-Z0-9]/g, '_');

      if (messageType === 'text' && incomingMessageText) {
        logger.info(`Processing text message from ${senderNumber} (${safeSenderId}): ${incomingMessageText}`);
        
        const conversationHistory = loadConversationHistory(safeSenderId);
        
        const geminiReply = await getGeminiResponse(incomingMessageText, conversationHistory);
        
        if (geminiReply) {
          const messageChunks = splitMessage(geminiReply);
          
          for (let i = 0; i < messageChunks.length; i++) {
            const success = await sendWhatsappMessage(senderNumber, messageChunks[i], 'text');
            if (!success) {
              logger.error(`Failed to send message chunk to ${senderNumber}`);
              break;
            }
            
            if (i < messageChunks.length - 1) {
              const delay = Math.random() * (1.5 - 0.55) + 0.55;
              await new Promise(resolve => setTimeout(resolve, delay * 1000));
            }
          }
          
          conversationHistory.push({ role: 'user', parts: [{ text: incomingMessageText }] });
          conversationHistory.push({ role: 'model', parts: [{ text: geminiReply }] });
          saveConversationHistory(safeSenderId, conversationHistory);
        }
      } else if (incomingMessageText) {
        logger.info(`Received '${messageType}' message from ${senderNumber}. No text content. Full data: ${JSON.stringify(messageInfo)}`);
      } else if (messageType !== 'unknown') {
        logger.info(`Received '${messageType}' message from ${senderNumber}. No text content. Full data: ${JSON.stringify(messageInfo)}`);
      } else {
        logger.warning(`Received unhandled or incomplete message from ${senderNumber}. Data: ${JSON.stringify(messageInfo)}`);
      }
    } else if (data.event) {
      logger.info(`Received event '${data.event}' which is not 'messages.upsert'. Data: ${JSON.stringify(data).substring(0, 200)}`);
    }

    return res.status(200).json({ status: 'success' });
  } catch (error) {
    logger.error(`Error processing webhook: ${error}`, error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`WhatsApp Gemini AI Assistant server running on port ${PORT}`);
});

module.exports = app;