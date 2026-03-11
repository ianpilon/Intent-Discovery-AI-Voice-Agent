# Intent Discovery AI — Voice Bot with Conversation Memory

A proof-of-concept voice AI system using [Vapi](https://vapi.ai) that remembers previous conversations with callers. Built for client intent discovery with dual-mode support: Coach Mode (training interviewers) and Interview Mode (talking directly to clients).

## Features

- **Conversation Memory**: Automatically tracks and remembers caller history across multiple calls
- **Dual Mode**: Coach Mode for training interviewers + Interview Mode for direct client discovery
- **Transient Assistant Pattern**: Dynamically configures AI assistant per call via webhook
- **8-Tier Discovery Framework**: WHO, WHEN, WHAT, PAIN, WHY, HOW, WHAT ELSE, SYNTHESIS
- **GPT-4 Powered**: Advanced conversational AI capabilities
- **Human-Centered Design**: Focused on client comfort and trust

## Architecture

The system uses Vapi's transient assistant pattern, which means:
1. Each incoming call triggers a webhook to your server
2. Your server dynamically returns the assistant configuration
3. For returning callers, previous conversation history is injected into the system prompt
4. After calls end, transcripts are saved locally in JSON format

## Prerequisites

- Node.js (v14 or higher)
- A [Vapi](https://vapi.ai) account
- An [ElevenLabs](https://elevenlabs.io) account with a voice ID
- [ngrok](https://ngrok.com) or similar tool for exposing localhost to the internet

## Installation

1. Clone this repository:
```bash
git clone https://github.com/ianpilon/voice-bot-poc1.git
cd voice-bot-poc1
```

2. Install dependencies:
```bash
npm install
```

## Configuration

The system is pre-configured with ElevenLabs voice ID: `6rr4jpS124uCLNtgVdAk`

To customize the AI behavior, edit `enhanced-prompt.txt`.

## Running the Server

### Step 1: Start the Server

```bash
npm start
```

Server starts on port 3000.

### Step 2: Expose with ngrok

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`).

### Step 3: Configure Vapi

1. Log into [Vapi Dashboard](https://dashboard.vapi.ai)
2. Go to Phone Numbers and select your number
3. Set Server URL to: `https://your-ngrok-url.ngrok.io/webhook/assistant-request`
4. Enable server messages: `end-of-call-report` and `transcript`

### Step 4: Test

Call your Vapi number. You should hear: "Hi, you've reached Intent Discovery AI. Quick question before we start..."

## File Structure

```
├── server-vapi-memory.js      # Main webhook server
├── enhanced-prompt.txt         # AI system prompt
├── vapi-memory.json           # Conversation storage (auto-created)
├── package.json               # Dependencies
├── test-webhook.js            # Test script
└── README.md                  # This file
```

## API Endpoints

- `POST /webhook/assistant-request` - Incoming call configuration
- `POST /webhook/end-of-call-report` - Save conversation history
- `POST /webhook/transcript` - Real-time transcript updates
- `GET /memory/:phone` - View caller history
- `DELETE /memory` - Clear all history

## License

MIT
