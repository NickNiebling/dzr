const axios = require("axios");
const config = require("../config/config");

const API_BASE_URL = config.contentApi.baseUrl;
const API_KEY = config.contentApi.apiKey;

/**
 * Get a random welcome message
 */
async function getWelcomeMessage() {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/messages/welcome-messages`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    
    const messages = response.data.filter(msg => msg.active);
    if (messages.length === 0) return null;
    
    // Return random message
    return messages[Math.floor(Math.random() * messages.length)];
  } catch (error) {
    console.error("❌ Error fetching welcome message:", error);
    return null;
  }
}

/**
 * Get scheduled messages that are due
 */
async function getDueScheduledMessages() {
  try {
    console.log(`🔄 API Call: Fetching due scheduled messages...`);
    console.log(`   URL: ${API_BASE_URL}/api/schedules/due`);
    
    const response = await axios.get(`${API_BASE_URL}/api/schedules/due`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    
    console.log(`✅ API Response: Received ${response.data.length} due messages`);
    
    if (response.data.length > 0) {
      console.log(`📋 Due messages:`, response.data.map(msg => ({
        id: msg.id,
        title: msg.title,
        channel_id: msg.channel_id,
        next_run: msg.next_run,
        last_sent: msg.last_sent
      })));
    }
    
    return response.data;
  } catch (error) {
    console.error("❌ API Error fetching scheduled messages:", error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, error.response.data);
    }
    return [];
  }
}

/**
 * Get messages selected for probability-based sending
 */
async function getProbabilitySelectedMessages() {
  try {
    console.log(`🔄 API Call: Checking probability-based messages...`);
    console.log(`   URL: ${API_BASE_URL}/api/schedules/probability-check`);
    
    const response = await axios.post(`${API_BASE_URL}/api/schedules/probability-check`, {}, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    
    console.log(`✅ API Response: Probability check completed`);
    console.log(`   Selection method: ${response.data.selection_method || 'unknown'}`);
    console.log(`   Messages to send: ${response.data.messages_to_send.length}`);
    console.log(`   Total eligible: ${response.data.total_eligible}`);
    console.log(`   Channels with eligible messages: ${response.data.channels_with_eligible_messages || 'unknown'}`);
    console.log(`   Global daily probability: ${response.data.global_daily_probability}`);
    
    if (response.data.messages_to_send.length > 0) {
      console.log(`📋 Selected message:`, response.data.messages_to_send.map(msg => ({
        id: msg.id,
        title: msg.title,
        channel_id: msg.channel_id,
        likelihood: msg.schedule?.likelihood || 1.0
      })));
    } else {
      console.log(`🎲 No message selected - probability roll failed or no eligible messages`);
    }
    
    return response.data.messages_to_send;
  } catch (error) {
    console.error("❌ API Error checking probability messages:", error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, error.response.data);
    }
    return [];
  }
}

/**
 * Mark a scheduled message as sent
 */
async function markScheduledMessageSent(scheduleId) {
  try {
    console.log(`🔄 API Call: Marking schedule ${scheduleId} as sent...`);
    console.log(`   URL: ${API_BASE_URL}/api/schedules/${scheduleId}/sent`);
    
    const response = await axios.post(`${API_BASE_URL}/api/schedules/${scheduleId}/sent`, {}, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    
    console.log(`✅ API Response: Schedule ${scheduleId} marked as sent successfully`);
    console.log(`   Response status: ${response.status}`);
    console.log(`   Response data:`, response.data);
    
  } catch (error) {
    console.error(`❌ API Error marking schedule ${scheduleId} as sent:`, error.message);
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Data:`, error.response.data);
    }
  }
}

/**
 * Process message content (replace variables)
 */
function processMessageContent(content, variables = {}) {
  let processed = content;
  
  // Handle built-in variables first
  const builtInVariables = {
    random_emoji: getRandomEmoji(),
    timestamp: Math.floor(Date.now() / 1000),
    datetime: new Date().toLocaleString(),
  };
  
  // Replace built-in variables
  Object.entries(builtInVariables).forEach(([key, value]) => {
    processed = processed.replace(new RegExp(`{${key}}`, 'g'), value);
  });
  
  // Replace custom variables like {username}, {server_name}, etc.
  Object.entries(variables).forEach(([key, value]) => {
    processed = processed.replace(new RegExp(`{${key}}`, 'g'), value);
  });
  
  return processed;
}

/**
 * Get a random emoji
 */
function getRandomEmoji() {
  const emojis = [
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
    '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
    '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩',
    '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣',
    '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
    '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗',
    '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯',
    '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐',
    '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈',
    '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾',
    '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿',
    '😾', '🚀', '🌟', '⭐', '✨', '💫', '🔥', '💥', '💯', '👍',
    '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆',
    '🖕', '👇', '☝️', '👍', '👎', '👊', '✊', '🤛', '🤜', '👏',
    '🙌', '👐', '🤲', '🤝', '🙏', '💪', '🦾', '🦿', '🦵', '🦶'
  ];
  
  return emojis[Math.floor(Math.random() * emojis.length)];
}

/**
 * Refresh Zwift club roster in the backend (writes to Firestore)
 */
async function saveMemberSnapshot() {
  const response = await axios.post(`${API_BASE_URL}/api/discord/stats/snapshot`, { source: 'scheduled' }, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    timeout: 120000,
  });
  return response.data;
}

async function refreshClubRoster() {
  const response = await axios.post(`${API_BASE_URL}/api/zwift/club/roster/refresh`, {}, {
    headers: { Authorization: `Bearer ${API_KEY}` }
  });
  return response.data;
}

/**
 * Refresh ZwiftPower club roster in the backend (writes to Firestore)
 */
async function refreshZwiftPowerRoster() {
  const response = await axios.post(`${API_BASE_URL}/api/zwiftpower/club/roster/refresh`, {}, {
    headers: { Authorization: `Bearer ${API_KEY}` }
  });
  return response.data;
}

/**
 * Move WKG Zwifty Fifty finishers from 1.5 to 4 hours after the start, and set sprints about a day after Apply.
 */
async function fixDueFiftyResults() {
  const response = await axios.post(`${API_BASE_URL}/api/zwiftpower/results/fix-due`, {}, {
    headers: { Authorization: `Bearer ${API_KEY}` }
  });
  return response.data;
}

/**
 * Apply the next After Party or Zwifty Fifty route once Zwift has created the event.
 * The site decides whether a series is due.
 */
async function applyDueWeeklySeries() {
  const secret = String(process.env.WEEKLY_SERIES_CRON_SECRET || "").trim();
  if (!secret) {
    const error = new Error("WEEKLY_SERIES_CRON_SECRET is not set");
    error.code = "missing_cron_secret";
    throw error;
  }
  const site = String(process.env.DZR_SITE_URL || "https://www.dzrracingseries.com").replace(/\/$/, "");
  const response = await axios.post(`${site}/api/cron/weekly-series`, {}, {
    headers: { Authorization: `Bearer ${secret}` },
    timeout: 60000,
  });
  return response.data;
}

module.exports = {
  getWelcomeMessage,
  getDueScheduledMessages,
  getProbabilitySelectedMessages,
  markScheduledMessageSent,
  processMessageContent,
  saveMemberSnapshot,
  refreshClubRoster,
  refreshZwiftPowerRoster,
  fixDueFiftyResults,
  applyDueWeeklySeries,
}; 