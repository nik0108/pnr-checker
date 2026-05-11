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
    
    // Using free ConfirmTkt API (no API key needed!)
    const url = `https://api.confirmtkt.com/api/pnr/getPNRStatus/${PNR_NUMBER}/`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const data = response.data;
    
    // Check if PNR status is valid
    if (data.PnrNumber && data.Pnr) {
      const passengers = data.PassengerStatus ? 
        (Array.isArray(data.PassengerStatus) ? data.PassengerStatus : [data.PassengerStatus]) 
        : [];
      
      return {
        success: true,
        pnr: data.Pnr || PNR_NUMBER,
        trainNumber: data.TrainNo || 'N/A',
        trainName: data.TrainName || 'N/A',
        from: data.From || 'N/A',
        to: data.To || 'N/A',
        passengers: passengers,
        chartStatus: data.ChartPrepared ? 'YES' : 'NO',
        class: data.JourneyClass || 'N/A',
        travelDate: data.JourneyDate || 'N/A',
        boardingPoint: data.BoardingPoint || 'N/A',
        reservationUpto: data.ReservationUpto || 'N/A'
      };
    } else {
      return {
        success: false,
        error: data.Error || 'PNR not found or invalid'
      };
    }
  } catch (error) {
    console.error('❌ PNR Check Error:', error.message);
    
    // Try fallback API
    try {
      console.log('Trying fallback API...');
      const fallbackUrl = `https://confirmtkt.com/pnr/${PNR_NUMBER}`;
      await axios.get(fallbackUrl);
      
      return {
        success: false,
        error: 'PNR data temporarily unavailable. Try again in 5 minutes.'
      };
    } catch (fallbackError) {
      return {
        success: false,
        error: 'Unable to fetch PNR status. Check your PNR number and try again.'
      };
    }
  }
}

// ============================================
// 2. Function to format status message
// ============================================
function formatStatusMessage(data) {
  if (!data.success) {
    return `❌ Error checking PNR\n${data.error}\n\nTry checking manually:\nhttps://www.confirmtkt.com/pnr/${PNR_NUMBER}`;
  }

  let passengerList = '';
  if (data.passengers && data.passengers.length > 0) {
    if (typeof data.passengers[0] === 'string') {
      // Passengers is a string or array of strings
      data.passengers.forEach((p, idx) => {
        passengerList += `\n${idx + 1}. ${p}`;
      });
    } else {
      // Passengers is an object or array of objects
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
