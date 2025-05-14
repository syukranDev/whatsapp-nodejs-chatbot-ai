# Affordable WhatsApp AI Chatbot Built with Node.js: Just $6/month

Create a powerful WhatsApp chatbot powered by Google's Gemini AI for just $6/month (WaSenderAPI subscription) plus Google's free Gemini API tier (1500 requests/month). This Node.js-based solution uses Express.js to handle incoming messages via WaSenderAPI webhooks and leverages Gemini's advanced AI capabilities to generate intelligent, conversational responses.

## 💰 Cost-Effective Solution

- **WaSenderAPI**: Only $6/month for WhatsApp integration  
- **Gemini AI**: Free tier with 1500 requests/month  
- **Hosting**: Run locally or on affordable cloud platforms (e.g., Heroku, DigitalOcean)  
- **No WhatsApp Business API fees**: Uses WaSenderAPI as an affordable alternative  

## 🔥 Key Features

- **WhatsApp Integration**: Receives and sends messages through WaSenderAPI  
- **AI-Powered Responses**: Generates intelligent replies using Google's Gemini AI  
- **Media Support**: Handles text, images, audio, video, and document messages  
- **Smart Message Splitting**: Automatically breaks long responses into multiple messages for better readability  
- **Customizable AI Persona**: Tailor the bot's personality and behavior via simple JSON configuration  
- **Conversation History**: Maintains context between messages for natural conversations  
- **Robust Error Handling**: Detailed logging and error management for reliable operation  
- **Easy Configuration**: Simple setup with environment variables  

## 📁 Project Structure

```
/whatsapp-nodejs-chatbot/
├── app.js # Main Express application and bot logic
├── package.json # Node.js dependencies and scripts
├── .env # Environment variables (API keys, tokens)
├── persona.json # Customizable AI personality settings
└── README.md # This file
```


## 🚀 Setup and Installation

1. **Clone the repository**

2. **Initialize Node.js project and install dependencies:**

    ```bash
    npm init -y
    npm install express axios dotenv morgan @google/generative-ai
    ```

3. **Configure Environment Variables:**  
    Create a `.env` file in the project root directory (do **not** commit this file if it contains sensitive keys):

    ```bash
    GEMINI_API_KEY="YOUR_GEMINI_API_KEY_HERE" # Free tier: 1500 requests/month
    WASENDER_API_TOKEN="YOUR_WASENDER_API_TOKEN_HERE" # $6/month subscription
    PORT=5001 # Optional: default is 5001
    ```

    Replace placeholders with your actual API keys.

4. **Create or customize `persona.json`** to define your bot’s personality and behavior.

## 🏃‍♂️ Running the Application

### 1. Development Mode

Start the Express server locally:

```bash
node app.js
```

The app will listen on `http://0.0.0.0:5001/` (or the port set in your `.env`).

### 2. Using ngrok for Webhook Testing

WaSenderAPI requires a publicly accessible URL for webhook events. Use [ngrok](https://ngrok.com/) to expose your local server:

```bash
ngrok http 5001
```


Copy the generated public URL (e.g., `https://xxxx.ngrok.io`) and set your webhook URL in WaSenderAPI dashboard as:

```bash
https://xxxx.ngrok.io/webhook
```

### 3. Production Deployment

Use a process manager like [PM2](https://pm2.keymetrics.io/) or run behind a reverse proxy (Nginx) for production.

Example with PM2:

```bash
npm install pm2 -g
pm2 start app.js --name whatsapp-bot
```

## 🔄 WaSenderAPI Webhook Configuration

- Log in to your WaSenderAPI dashboard.  
- Connect your phone number to a session.  
- Set or update the webhook URL to your public endpoint (e.g., ngrok URL or production URL) with `/webhook` path.  
- Enable only the **messages.upsert** event.  
- Save changes.

## 📝 Customizing Your Bot's Personality

Edit the `persona.json` file to customize the AI persona and base prompt. For example:

```bash
{
"name": "WhatsApp Assistant",
"base_prompt": "You are a helpful and concise AI assistant replying in a WhatsApp chat. Do not use Markdown formatting. Keep your answers short, friendly, and easy to read. If your response is longer than 3 lines, split it into multiple messages using \n every 3 lines. Each \n means a new WhatsApp message. Avoid long paragraphs or unnecessary explanations.",
"description": "You are a friendly WhatsApp assistant. Keep your responses concise and clear."
}
```

Note: This influences how Gemini AI generates replies.

## 📊 Logging and Error Handling

- Uses `morgan` for HTTP request logging.  
- Logs detailed info and errors to the console.  
- Customize logging as needed for production (file logs, external services).


## 💡 Why This Solution?

This chatbot offers a cost-effective way to deploy an AI-powered WhatsApp bot without the high costs of WhatsApp Business API. By combining WaSenderAPI's affordable $6/month subscription with Google's free Gemini API tier, you get a powerful, customizable chatbot solution at a fraction of the cost of enterprise alternatives.
