const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const morgan = require('morgan');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

const app = express();
const PORT = 5001;
const CONVERSATIONS_DIR = 'conversations';

async function ensureConversationsDir() {
  try {
    await fs.access(CONVERSATIONS_DIR);
  } catch {
    await fs.mkdir(CONVERSATIONS_DIR);
    console.info(`Created conversations directory at ${CONVERSATIONS_DIR}`);
  }
}

ensureConversationsDir();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WASENDER_API_TOKEN = process.env.WASENDER_API_TOKEN;
const WASENDER_API_URL = 'https://wasenderapi.com/api/send-message';

if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not found in environment variables. The application might not work correctly.');
}

app.use(express.json({ limit: '80kb' }));
app.use(express.urlencoded({ extended: true, limit: '20kb' }));
app.use(morgan('combined'));

// Load persona from persona.json or use defaults
const PERSONA_FILE_PATH = 'persona.json';
let PERSONA_DESCRIPTION = "You are a helpful assistant.";
let PERSONA_NAME = "Assistant";
const BASE_PROMPT = "You are a helpful and concise AI assistant replying in a WhatsApp chat. Do not use Markdown formatting. Keep your answers short, friendly, and easy to read. If your response is longer than 3 lines, split it into multiple messages using \\n every 3 lines. Each \\n means a new WhatsApp message. Avoid long paragraphs or unnecessary explanations.";

(async () => {
  try {
    const personaRaw = await fs.readFile(PERSONA_FILE_PATH, 'utf-8');
    const personaData = JSON.parse(personaRaw);
    const customDescription = personaData.description || PERSONA_DESCRIPTION;
    const basePrompt = personaData.base_prompt || BASE_PROMPT;
    PERSONA_DESCRIPTION = `${basePrompt}\n\n${customDescription}`;
    PERSONA_NAME = personaData.name || PERSONA_NAME;
    console.info(`Successfully loaded persona: ${PERSONA_NAME}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Persona file not found at ${PERSONA_FILE_PATH}. Using default persona.`);
    } else if (err.name === 'SyntaxError') {
      console.error(`Error decoding JSON from ${PERSONA_FILE_PATH}. Using default persona.`);
    } else {
      console.error(`Unexpected error loading persona: ${err}. Using default persona.`);
    }
  }
})();

// Initialize Google Generative AI client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function loadConversationHistory(userId) {
  const filePath = path.join(CONVERSATIONS_DIR, `${userId}.json`);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const history = JSON.parse(data);
    if (Array.isArray(history) && history.every(item => item.role && item.parts)) {
      return history;
    } else {
      console.warn(`Invalid history format in ${filePath}. Starting fresh.`);
      return [];
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Error loading history from ${filePath}: ${err}`);
    }
    return [];
  }
}

async function saveConversationHistory(userId, history) {
  const filePath = path.join(CONVERSATIONS_DIR, `${userId}.json`);
  try {
    await fs.writeFile(filePath, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error(`Error saving conversation history to ${filePath}: ${err}`);
  }
}

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

async function getGeminiResponse(messageText, conversationHistory = null) {
  if (!GEMINI_API_KEY) {
    console.error("Gemini API key is not configured.");
    return "Sorry, I'm having trouble connecting to my brain right now (API key issue).";
  }

  try {
    const modelName = 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({ model: modelName, systemInstruction: PERSONA_DESCRIPTION });

    if (conversationHistory && conversationHistory.length > 0) {
      const chat = model.startChat({ history: conversationHistory });
      const response = await chat.sendMessage(messageText);
      if (response && response.text) {
        return response.text.trim();
      }
      if (response && response.candidates) {
        try {
          return response.candidates[0].content.parts[0].text.trim();
        } catch {
          console.error("Error parsing Gemini response candidates.");
          return "I received an unusual response structure from Gemini. Please try again.";
        }
      }
      return "I received an empty or unexpected response from Gemini. Please try again.";
    } else {
      const response = await model.generateContent(messageText);
      if (response && response.text) {
        return response.text.trim();
      }
      if (response && response.candidates) {
        try {
          return response.candidates[0].content.parts[0].text.trim();
        } catch {
          console.error("Error parsing Gemini response candidates.");
          return "I received an unusual response structure from Gemini. Please try again.";
        }
      }
      return "I received an empty or unexpected response from Gemini. Please try again.";
    }
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return "I'm having trouble processing that request with my AI brain. Please try again later.";
  }
}

async function sendWhatsAppMessage(recipientNumber, messageContent, messageType = 'text', mediaUrl = null) {
  if (!WASENDER_API_TOKEN) {
    console.error("WaSender API token is not set. Please check .env file.");
    return false;
  }

  let formattedRecipientNumber = recipientNumber;
  if (recipientNumber && recipientNumber.includes('@s.whatsapp.net')) {
    formattedRecipientNumber = recipientNumber.split('@')[0];
  }

  const headers = {
    Authorization: `Bearer ${WASENDER_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const payload = { to: formattedRecipientNumber };

  switch (messageType) {
    case 'text':
      payload.text = messageContent;
      break;
    case 'image':
      if (!mediaUrl) {
        console.error("Media URL is required for image messages.");
        return false;
      }
      payload.imageUrl = mediaUrl;
      if (messageContent) payload.text = messageContent;
      break;
    case 'video':
      if (!mediaUrl) {
        console.error("Media URL is required for video messages.");
        return false;
      }
      payload.videoUrl = mediaUrl;
      if (messageContent) payload.text = messageContent;
      break;
    case 'audio':
      if (!mediaUrl) {
        console.error("Media URL is required for audio messages.");
        return false;
      }
      payload.audioUrl = mediaUrl;
      break;
    case 'document':
      if (!mediaUrl) {
        console.error("Media URL is required for document messages.");
        return false;
      }
      payload.documentUrl = mediaUrl;
      if (messageContent) payload.text = messageContent;
      break;
    default:
      console.error(`Unsupported message type or missing content/media_url: ${messageType}`);
      return false;
  }

  try {
    const response = await axios.post(WASENDER_API_URL, payload, { headers, timeout: 20000 });
    console.info(`Message sent to ${recipientNumber}. Response:`, response.data);
    return true;
  } catch (error) {
    const statusCode = error.response ? error.response.status : 'N/A';
    const responseText = error.response ? error.response.data : 'N/A';
    console.error(`Error sending WhatsApp message to ${recipientNumber} (Status: ${statusCode}):`, error.message);
    if (statusCode === 422) {
      console.error("WaSenderAPI 422 Error: Check payload format and message content.");
    }
    return false;
  }
}

app.post('/webhook', async (req, res) => {
  const data = req.body;
  console.info(`Received webhook data (first 200 chars): ${JSON.stringify(data).slice(0, 200)}`);

  try {
    if (data.event === 'messages.upsert' && data.data && data.data.messages) {
      const messageInfo = data.data.messages;

      if (messageInfo.key?.fromMe) {
        console.info(`Ignoring self-sent message: ${messageInfo.key.id}`);
        return res.status(200).json({ status: 'success', message: 'Self-sent message ignored' });
      }

      const senderNumber = messageInfo.key?.remoteJid;
      if (!senderNumber) {
        console.warn("Webhook received message without sender information.");
        return res.status(400).json({ status: 'error', message: 'Incomplete sender data' });
      }

      const safeSenderId = senderNumber.replace(/[^a-zA-Z0-9]/g, '_');

      let incomingMessageText = null;
      let messageType = 'unknown';

      if (messageInfo.message) {
        const msgContentObj = messageInfo.message;
        if ('conversation' in msgContentObj) {
          incomingMessageText = msgContentObj.conversation;
          messageType = 'text';
        } else if (msgContentObj.extendedTextMessage?.text) {
          incomingMessageText = msgContentObj.extendedTextMessage.text;
          messageType = 'text';
        }
      }

      if (messageInfo.messageStubType) {
        const stubParams = messageInfo.messageStubParameters || [];
        console.info(`Received system message of type ${messageInfo.messageStubType} from ${senderNumber}. Stub params: ${stubParams}`);
        return res.status(200).json({ status: 'success', message: 'System message processed' });
      }

      if (messageType === 'text' && incomingMessageText) {
        console.info(`Processing text message from ${senderNumber} (${safeSenderId}): ${incomingMessageText}`);

        const conversationHistory = await loadConversationHistory(safeSenderId);
        const geminiReply = await getGeminiResponse(incomingMessageText, conversationHistory);

        if (geminiReply) {
          const messageChunks = splitMessage(geminiReply);
          for (let i = 0; i < messageChunks.length; i++) {
            const chunk = messageChunks[i];
            const sent = await sendWhatsAppMessage(senderNumber, chunk, 'text');
            if (!sent) {
              console.error(`Failed to send message chunk to ${senderNumber}`);
              break;
            }
            if (i < messageChunks.length - 1) {
              const delayMs = Math.random() * (1500 - 550) + 550;
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
          }
          conversationHistory.push({ role: 'user', parts: [incomingMessageText] });
          conversationHistory.push({ role: 'model', parts: [geminiReply] });
          await saveConversationHistory(safeSenderId, conversationHistory);
        }
      } else if (incomingMessageText) {
        console.info(`Received '${messageType}' message from ${senderNumber}. No text content. Full data:`, messageInfo);
      } else {
        console.warn(`Received unhandled or incomplete message from ${senderNumber}. Data:`, messageInfo);
      }
    } else if (data.event) {
      console.info(`Received event '${data.event}' which is not 'messages.upsert'. Data: ${JSON.stringify(data).slice(0, 200)}`);
    }

    return res.status(200).json({ status: 'success' });
  } catch (err) {
    console.error('Error processing webhook:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled Exception:', err);
  res.status(500).json({ status: 'error', message: 'An internal server error occurred.' });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
