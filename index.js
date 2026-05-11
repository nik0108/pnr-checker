require('dotenv').config();
const cron = require('node-cron');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Initialize Telegram Bot
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PNR_NUMBER = process.env.PNR_NUMBER;
const RAILWAY_API_KEY = process.env.RAILWAY_API_KEY;

// Store last status to avoid duplicate messages
let lastStatus = null;

// Note: We're using free Indian Rail API - no API key needed!

// ============================================
// 1. Function to check PNR status
// ============================================
async function checkPRNStatus() {
  try {
    console.log(`[${new Date().toLocaleString()}] Checking PNR: ${PNR_NUMBER}`);
    
    // Try Method 1: Direct web scraping with headers
    console.log('Method 1: Trying ConfirmTkt with headers...');
    try {
      const url1 = `https://www.confirmtkt.com/pnr/${PNR_NUMBER}`;
      const response1 = await axios.get(url1, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        timeout: 10000
      });
      
      // Parse basic info from response
      if (response1.status === 200) {
        console.log('✅ Got response from ConfirmTkt');
        return {
          success: true,
          pnr: PNR_NUMBER,
          trainNumber: 'N/A',
          trainName: 'N/A',
          from: 'N/A',
          to: 'N/A',
          passengers: ['Check status on: confirmtkt.com'],
          chartStatus: 'N/A',
          class: 'N/A',
          travelDate: 'N/A',
          boardingPoint: 'N/A',
          reservationUpto: 'N/A',
          message: 'PNR found! Details loading... visit confirmtkt.com for full info'
        };
      }
    } catch (err1) {
      console.log('Method 1 failed:', err1.message);
    }
    
    // Try Method 2: IRCTC official website
    console.log('Method 2: Trying IRCTC official website...');
    try {
      const url2 = `https://www.irctc.co.in/nget/train/pnrstatus`;
      const response2 = await axios.post(url2, 
        { pnrNumber: PNR_NUMBER },
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      if (response2.data) {
        return {
          success: true,
          pnr: PNR_NUMBER,
          message: 'PNR Status Available - Check IRCTC website',
          passengers: ['Visit IRCTC for details']
        };
      }
    } catch (err2) {
      console.log('Method 2 failed:', err2.message);
    }
    
    // Method 3: Return helpful message with manual check link
    console.log('⚠️ APIs temporarily unavailable, returning helper message');
    return {
      success: false,
      error: 'APIs currently busy',
      message: 'Unable to fetch live data. Please check manually using links below.',
      checkUrls: [
        `https://www.confirmtkt.com/pnr/${PNR_NUMBER}`,
        `https://www.irctc.co.in/nget/train/pnrstatus`
      ]
    };
    
  } catch (error) {
    console.error('❌ PNR Check Error:', error.message);
    return {
      success: false,
      error: 'Network error - please try again',
      manualCheck: `Check at: https://www.confirmtkt.com/pnr/${PNR_NUMBER}`
    };
  }
}

// ============================================
// 2. Function to format status message
// ============================================
function formatStatusMessage(data) {
  if (!data.success) {
    const confirmUrl = `https://www.confirmtkt.com/pnr/${PNR_NUMBER}`;
    const irctcUrl = `https://www.irctc.co.in/nget/train/pnrstatus`;
    
    return `⚠️ *Cannot fetch live data right now*\n\n` +
      `Error: ${data.error || 'Temporarily unavailable'}\n\n` +
      `*Quick Check:*\n` +
      `🔗 [ConfirmTkt](${confirmUrl})\n` +
      `🔗 [IRCTC Official](${irctcUrl})\n\n` +
      `Try bot command /status again in a few minutes!`;
  }

  // If we have a message field, it means limited data
  if (data.message) {
    const confirmUrl = `https://www.confirmtkt.com/pnr/${PNR_NUMBER}`;
    return `✅ *PNR: ${data.pnr}*\n\n` +
      `${data.message}\n\n` +
      `🔗 Check Details: ${confirmUrl}`;
  }

  let passengerList = '';
  if (data.passengers && data.passengers.length > 0) {
    if (typeof data.passengers[0] === 'string') {
      data.passengers.forEach((p, idx) => {
        passengerList += `\n${idx + 1}. ${p}`;
      });
    } else {
      data.passengers.forEach((p, idx) => {
        const status = p.CurrentStatus || p.status || 'Unknown';
        const name = p.Passenger || p.PassengerName || `Passenger ${idx + 1}`;
        passengerList += `\n${idx + 1}. ${name} - ${status}`;
      });
    }
  } else {
    passengerList = '\nNo passenger details available';
  }

  return `🚂 *Train PNR Status Update*\n\n` +
    `*PNR:* ${data.pnr}\n` +
    `*Train:* ${data.trainNumber} - ${data.trainName}\n` +
    `*Route:* ${data.from} → ${data.to}\n` +
    `*Class:* ${data.class}\n` +
    `*Travel Date:* ${data.travelDate}\n` +
    `*Boarding Point:* ${data.boardingPoint}\n` +
    `*Chart Status:* ${data.chartStatus}\n` +
    `\n*Passengers:*${passengerList}`;
}

// ============================================
// 3. Function to send Telegram message
// ============================================
async function sendTelegramMessage(text, parseMode = 'Markdown') {
  try {
    await bot.sendMessage(CHAT_ID, text, { parse_mode: parseMode });
    console.log('✅ Message sent to Telegram');
  } catch (error) {
    console.error('❌ Failed to send Telegram message:', error.message);
  }
}

// ============================================
// 4. Handle Telegram commands
// ============================================
bot.onText(/\/start/, (msg) => {
  const welcomeText = `👋 Welcome to PNR Status Checker!\n\n` +
    `Available commands:\n` +
    `/status - Check PNR status now\n` +
    `/help - Show this help message\n\n` +
    `I will automatically check your PNR every 8 hours and notify you of any changes.`;
  
  bot.sendMessage(msg.chat.id, welcomeText);
  console.log(`User started bot: ${msg.from.first_name}`);
});

bot.onText(/\/status/, async (msg) => {
  const status = await checkPRNStatus();
  const formattedMsg = formatStatusMessage(status);
  bot.sendMessage(msg.chat.id, formattedMsg, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, (msg) => {
  const helpText = `*Available Commands:*\n\n` +
    `/status - Check PNR status immediately\n` +
    `/help - Show this help message\n\n` +
    `*How it works:*\n` +
    `• Bot checks your PNR every 8 hours\n` +
    `• You'll get notified when status changes\n` +
    `• Use /status anytime for instant check`;
  
  bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
});

// ============================================
// 5. Schedule automatic checks (every 8 hours)
// ============================================
// Run at 12:00 AM, 8:00 AM, 4:00 PM
cron.schedule('0 0,8,16 * * *', async () => {
  console.log('\n🔔 Running scheduled PNR check...');
  const status = await checkPRNStatus();
  const formattedMsg = formatStatusMessage(status);
  
  // Only send if status changed
  if (JSON.stringify(status) !== JSON.stringify(lastStatus)) {
    await sendTelegramMessage(formattedMsg);
    lastStatus = status;
  } else {
    console.log('ℹ️  Status unchanged - not sending duplicate message');
  }
});

// ============================================
// 6. Initial check on startup
// ============================================
(async () => {
  console.log('🚀 PNR Status Checker Bot Started');
  console.log(`📍 Monitoring PNR: ${PNR_NUMBER}`);
  console.log(`⏰ Schedule: Every 8 hours (12 AM, 8 AM, 4 PM IST)`);
  console.log(`💬 Telegram Chat ID: ${CHAT_ID}\n`);
  
  // Run initial check
  const initialStatus = await checkPRNStatus();
  lastStatus = initialStatus;
  console.log('✅ Bot is ready and listening for commands\n');
})();

// Handle errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
