require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`\n📨 ${req.method} ${req.path}`);
  next();
});

const MEMORY_FILE = path.join(__dirname, 'vapi-memory.json');

// Initialize memory
if (!fs.existsSync(MEMORY_FILE)) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify({ customers: {} }, null, 2));
}

function readMemory() {
  return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
}

function writeMemory(data) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
}

function getCustomerHistory(phoneNumber) {
  const memory = readMemory();
  return memory.customers[phoneNumber] || null;
}

function saveCallTranscript(phoneNumber, callId, transcript, metadata) {
  const memory = readMemory();

  if (!memory.customers[phoneNumber]) {
    memory.customers[phoneNumber] = {
      phoneNumber,
      firstCall: new Date().toISOString(),
      callHistory: [],
      conversationSummary: ''
    };
  }

  const customer = memory.customers[phoneNumber];
  customer.callHistory.push({
    callId,
    date: new Date().toISOString(),
    transcript,
    metadata
  });

  // Build a conversation summary from last 3 calls (or all if fewer than 3)
  const recentCalls = customer.callHistory.slice(-3);
  customer.conversationSummary = buildConversationSummary(recentCalls);

  writeMemory(memory);
  console.log(`💾 Saved conversation for ${phoneNumber} (${customer.callHistory.length} total calls)`);
}

function buildConversationSummary(recentCalls) {
  if (recentCalls.length === 0) return '';

  let summary = `PREVIOUS CONVERSATION HISTORY:\n`;
  summary += `This caller has called ${recentCalls.length} time(s) before.\n\n`;

  recentCalls.forEach((call, index) => {
    const callDate = new Date(call.date).toLocaleDateString();
    summary += `Call ${index + 1} (${callDate}):\n`;

    // Include FULL transcript (both user and assistant messages) for complete context
    const fullConversation = call.transcript
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.message}`)
      .join('\n');

    // Add the call summary if available (Vapi provides this)
    if (call.metadata?.summary) {
      summary += `Summary: ${call.metadata.summary}\n\n`;
    }

    // Include transcript excerpt (truncate if too long, but keep more than 300 chars)
    const maxLength = 800;
    if (fullConversation.length > maxLength) {
      summary += fullConversation.substring(0, maxLength) + '...\n\n';
    } else {
      summary += fullConversation + '\n\n';
    }
  });

  summary += `\nIMPORTANT: Reference specific details from the previous conversation history above. The caller expects you to remember what they shared.\n`;

  return summary;
}

// Universal webhook handler - handles ALL Vapi server messages
app.post('/webhook/assistant-request', async (req, res) => {
  const messageType = req.body.message?.type || req.body.type;

  // Route to appropriate handler based on message type
  if (messageType === 'end-of-call-report') {
    return handleEndOfCall(req, res);
  } else if (messageType === 'transcript') {
    return handleTranscript(req, res);
  } else if (messageType === 'assistant-request') {
    return handleAssistantRequest(req, res);
  }

  // Unknown message type
  console.log(`⚠️  Unknown message type: ${messageType}`);
  return res.sendStatus(200);
});

// Handle assistant-request webhook
async function handleAssistantRequest(req, res) {
  // Log the full payload to understand Vapi's structure
  console.log('\n🔍 DEBUG: Full webhook payload:');
  console.log(JSON.stringify(req.body, null, 2));

  // Extract phone number from the webhook payload
  const phoneNumber = req.body.message?.call?.customer?.number ||
                     req.body.message?.customer?.number ||
                     req.body.call?.customer?.number;

  console.log(`\n📞 Incoming call from: ${phoneNumber}`);

  // Load base prompt
  const basePrompt = fs.readFileSync(
    path.join(__dirname, 'enhanced-prompt.txt'),
    'utf8'
  );

  // Check if this customer has previous conversation history
  const customer = getCustomerHistory(phoneNumber);

  const pronunciationNote = "";

  let systemPrompt = basePrompt + pronunciationNote;
  let firstMessage = "Hi, you've reached Intent Discovery AI. Quick question before we start - are you looking for coaching on discovering what your clients need, or are you the one trying to figure out what you need? Either way works great.";

  if (!customer) {
    console.log(`   🆕 NEW CALLER - no history`);
  } else {
    // RETURNING CALLER - Inject conversation history
    console.log(`   ✅ RETURNING CALLER - ${customer.callHistory.length} previous call(s)`);
    systemPrompt = `${basePrompt}${pronunciationNote}\n\n---\n\n${customer.conversationSummary}`;
    firstMessage = "Welcome back to Intent Discovery AI! I remember our last conversation. Ready to pick up where we left off?";
    console.log(`   💭 Injecting conversation history (${customer.conversationSummary.length} chars)`);
  }

  // Return assistant configuration - use messages array for transient webhooks
  return res.json({
    assistant: {
      firstMessage: firstMessage,
      model: {
        provider: "openai",
        model: "gpt-4",
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: systemPrompt
          }
        ]
      },
      recordingEnabled: true,
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: "en"
      },
      endCallPhrases: ["goodbye", "bye", "talk to you later", "gotta go", "have to go"],
      maxDurationSeconds: 1800,
      backgroundSound: "off",
      backchannelingEnabled: true,
      backgroundDenoisingEnabled: true,
      serverMessages: ["end-of-call-report", "transcript"]
    }
  });
}

// Handle end-of-call webhook
function handleEndOfCall(req, res) {
  console.log('\n🔍 DEBUG: End-of-call payload:');
  console.log(JSON.stringify(req.body, null, 2));

  const message = req.body.message || req.body;
  const call = message.call;
  const artifact = message.artifact;
  const phoneNumber = call?.customer?.number;

  console.log(`\n📞 Call ended: ${call?.id}`);
  console.log(`   Customer: ${phoneNumber}`);
  console.log(`   Duration: ${call?.endedReason}`);

  if (!phoneNumber || !artifact?.transcript) {
    console.log('   ⚠️  No phone number or transcript - skipping save');
    return res.sendStatus(200);
  }

  // Parse transcript from artifact.messages (Vapi's actual format)
  const messages = artifact.messagesOpenAIFormatted || artifact.messages || [];
  const parsedTranscript = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role,
      message: m.content || m.message
    }));

  // Save the conversation
  saveCallTranscript(phoneNumber, call.id, parsedTranscript, {
    duration: call.duration,
    endedReason: call.endedReason,
    cost: call.cost,
    summary: message.summary || ''
  });

  return res.sendStatus(200);
}

// Handle transcript updates
function handleTranscript(req, res) {
  const message = req.body.message || req.body;
  const transcript = message.transcript;
  const role = transcript?.role === 'user' ? '👤 User' : '🤖 Assistant';
  console.log(`   ${role}: ${transcript?.text || transcript?.transcript}`);
  return res.sendStatus(200);
}

// Keep legacy endpoints for compatibility
app.post('/webhook/end-of-call-report', handleEndOfCall);
app.post('/webhook/transcript', handleTranscript);

// API: View customer memory
app.get('/memory/:phone?', (req, res) => {
  const memory = readMemory();
  if (req.params.phone) {
    const customer = memory.customers[req.params.phone];
    return customer ? res.json(customer) : res.status(404).json({ error: 'Not found' });
  }
  res.json(memory);
});

// API: Clear all memory (for testing)
app.delete('/memory', (req, res) => {
  writeMemory({ customers: {} });
  res.json({ message: 'Memory cleared' });
});

app.listen(port, () => {
  console.log('\n🚀 Intent Discovery AI Server');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Server: http://localhost:${port}`);
  console.log(`🎯 Assistant webhook: POST /webhook/assistant-request`);
  console.log(`📝 End of call: POST /webhook/end-of-call-report`);
  console.log(`💬 Transcript: POST /webhook/transcript`);
  console.log(`💾 View memory: GET /memory/:phone`);
  console.log(`🗑️  Clear memory: DELETE /memory`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log('\n📋 Next Steps:');
  console.log('   1. Run ngrok: ngrok http 3000');
  console.log('   2. Update Vapi assistant with webhook URLs:');
  console.log('      - Server URL (Assistant Request): https://your-ngrok-url/webhook/assistant-request');
  console.log('      - End of Call Report: https://your-ngrok-url/webhook/end-of-call-report');
  console.log('   3. Make test calls to verify memory is working!\n');
});
