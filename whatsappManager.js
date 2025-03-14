const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

/**
 * Simple WhatsApp Manager - Singleton module to manage WhatsApp clients
 * 
 * Terminology:
 * - phoneNumber: The user's phone number in international format (e.g., '+1234567890')
 * - clientId: Internally used identifier derived from phoneNumber by removing the '+' prefix
 *   (e.g., phoneNumber '+1234567890' becomes clientId '1234567890')
 */
const whatsappManager = {
  // Map to store active WhatsApp clients, keyed by clientId (formatted phoneNumber)
  clients: new Map(),
  
  // Global message handler
  globalMessageHandler: null,

  /**
   * Initialize the WhatsApp Manager
   * @returns {Object} - The WhatsApp Manager instance
   */
  initialize: function() {
    console.log('WhatsApp Manager initialized (using whatsapp-web.js)');
    return this;
  },

  /**
   * Format phone number to ensure correct format for internal use as clientId
   * @param {string} phoneNumber - Phone number to format (e.g., '+1234567890')
   * @returns {string} - Formatted phone number as clientId (e.g., '1234567890')
   */
  formatPhoneNumber: function(phoneNumber) {
    // Remove any '+' prefix if present to create clientId
    return phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
  },

  /**
   * Process an incoming message and pass to the global handler
   * @param {string} clientId - Client ID (formatted phoneNumber) that received the message
   * @param {Object} message - Raw message from whatsapp-web.js
   * @private
   */
  processMessage: function(clientId, message) {
    if (!this.globalMessageHandler) return;
    
    // Convert whatsapp-web.js message format to a consistent format
    const convertedMessage = {
      key: {
        remoteJid: message.from,
        fromMe: message.fromMe
      },
      message: {
        conversation: message.body
      },
      // Include client information
      // Both id and phoneNumber are set to clientId for backward compatibility
      clientInfo: {
        id: clientId,
        phoneNumber: clientId 
      }
    };
    
    // Handle media messages
    if (message.hasMedia) {
      if (message.type === 'image') {
        convertedMessage.message.imageMessage = {
          caption: message.body
        };
      } else if (message.type === 'document') {
        convertedMessage.message.documentMessage = {
          fileName: message.filename || 'document'
        };
      }
    }
    
    // Call the global handler
    try {
      this.globalMessageHandler(convertedMessage);
    } catch (error) {
      console.error(`Error in message handler:`, error);
    }
  },

  /**
   * Get a login QR code for a client
   * @param {string} phoneNumber - Phone number in international format (e.g., '+1234567890')
   * @param {Object} options - Optional configuration
   * @returns {Promise<{qr: string, clientId: string, authenticated: boolean}>}
   */
  getLoginQR: async function(phoneNumber, options = {}) {
    // Convert phoneNumber to clientId for internal tracking
    const clientId = this.formatPhoneNumber(phoneNumber);
    
    // Check if client already exists and is authenticated
    if (this.clients.has(clientId) && this.clients.get(clientId).authenticated) {
      return { qr: null, clientId, authenticated: true };
    }

    // Set up session directory
    const sessionDir = options.sessionDir || path.join('./sessions', clientId);
    
    // Create a new client
    const client = new Client({
      authStrategy: new LocalAuth({
          // store session data 
          // and store auth to reuse between restarts 
          dataPath: path.resolve(sessionDir),
          // Using phoneNumber as the clientId parameter for whatsapp-web.js
          // (This is different from our internal clientId)
          clientId: phoneNumber,
      }),
      restartOnAuthFail: true,
      puppeteer: {
          headless: true,
          bypassCSPL: true,
          timeout: 60000,
          args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--disable-gpu',
              '--window-size=1920,1080',
          ]
      },
      mediaOptions: {
          disableMedia: true,
          ffmpegPath: null,
          downloadMedia: false
      }
  });
    
    // Set up message handling
    client.on('message', (message) => {
      if (this.globalMessageHandler) {
        this.processMessage(clientId, message);
      }
    });

    // Create a promise to get the QR code
    const qrPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('QR code generation timed out'));
      }, 100000); // timeout (whatsapp-web.js can take longer to initialize)

      // QR code event
      client.on('qr', (qr) => {
        clearTimeout(timeout);
        resolve({ qr, clientId, authenticated: false });
      });

      // Ready event (already authenticated)
      client.on('ready', () => {
        clearTimeout(timeout);
        resolve({ qr: null, clientId, authenticated: true });
      });

      // Authentication failure event
      client.on('auth_failure', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Authentication failed: ${error}`));
      });
    });

    // Store client information
    this.clients.set(clientId, {
      client,
      sessionDir,
      authenticated: false
    });

    // Set up connection event handling
    client.on('ready', () => {
      console.log(`Connection established for ${clientId}`);
      const clientInfo = this.clients.get(clientId);
      if (clientInfo) {
        clientInfo.authenticated = true;
      }
    });

    client.on('disconnected', (reason) => {
      console.log(`Connection closed for ${clientId}. Reason: ${reason}`);
      this.clients.delete(clientId);
    });

    // Initialize the client
    client.initialize().catch(error => {
      console.error(`Error initializing client ${clientId}:`, error);
    });

    return qrPromise;
  },
  
  /**
   * Logout a WhatsApp client
   * @param {string} phoneNumber - Phone number in international format
   * @returns {Promise<boolean>} - True if logout was successful
   */
  logout: async function(phoneNumber) {
    const clientId = this.formatPhoneNumber(phoneNumber);
    const clientInfo = this.clients.get(clientId);
    
    if (!clientInfo) return false;

    try {
      await clientInfo.client.logout();
      this.clients.delete(clientId);
      return true;
    } catch (error) {
      console.error(`Error logging out client ${clientId}:`, error);
      return false;
    }
  },
  
  /**
   * Check if a client is authenticated
   * @param {string} phoneNumber - Phone number in international format
   * @returns {boolean} - Authentication status
   */
  isAuthenticated: function(phoneNumber) {
    const clientId = this.formatPhoneNumber(phoneNumber);
    const clientInfo = this.clients.get(clientId);
    return clientInfo ? clientInfo.authenticated === true : false;
  },

  /**
   * Send a message
   * @param {string} phoneNumber - Phone number in international format
   * @param {string} recipient - Recipient phone number (without @s.whatsapp.net)
   * @param {string|Object} content - Message content
   * @returns {Promise<Object|null>} - Message info if sent successfully
   */
  sendMessage: async function(phoneNumber, recipient, content) {
    const clientId = this.formatPhoneNumber(phoneNumber);
    const clientInfo = this.clients.get(clientId);
    
    if (!clientInfo) return null;

    try {
      // Format recipient to whatsapp-web.js format (just the number with country code)
      const formattedRecipient = recipient.includes('@s.whatsapp.net') 
        ? recipient.split('@')[0] 
        : recipient.replace(/[^0-9]/g, '');
      
      // Send the message
      if (typeof content === 'string') {
        // Text message
        return await clientInfo.client.sendMessage(`${formattedRecipient}@c.us`, content);
      } else if (content.image) {
        // Image message
        const media = content.image instanceof Buffer 
          ? new MessageMedia('image/jpeg', content.image.toString('base64'))
          : await MessageMedia.fromUrl(content.image);
        
        return await clientInfo.client.sendMessage(
          `${formattedRecipient}@c.us`, 
          media, 
          { caption: content.caption || '' }
        );
      } else {
        // Other message types
        console.warn('Unsupported message type:', content);
        return null;
      }
    } catch (error) {
      console.error(`Error sending message:`, error);
      return null;
    }
  },

  /**
   * Set the global message handler for all clients
   * @param {Function} callback - Callback function to handle messages from any client
   * @returns {boolean} - True if set successfully, false otherwise
   */
  onMessage: function(callback) {
    if (typeof callback !== 'function') {
      return false;
    }
    
    this.globalMessageHandler = callback;
    return true;
  },

  /**
   * Remove the global message handler
   * @returns {boolean} - Always returns true
   */
  offMessage: function() {
    this.globalMessageHandler = null;
    return true;
  },

  /**
   * Check if a client is initialized
   * @param {string} phoneNumber - Phone number in international format
   * @returns {boolean} - True if client exists
   */
  hasClient: function(phoneNumber) {
    const clientId = this.formatPhoneNumber(phoneNumber);
    return this.clients.has(clientId);
  },

  /**
   * Get the last 10 messages for a client
   * @param {string} phoneNumber - Phone number in international format
   * @returns {Promise<Array|null>} - Array of messages or null if client not found/authenticated
   */
  getLast10Messages: async function(phoneNumber) {
    // Convert phoneNumber to clientId for internal tracking
    const formattedClientId = this.formatPhoneNumber(phoneNumber);
    const clientInfo = this.clients.get(formattedClientId);
    
    if (!clientInfo || !clientInfo.authenticated) return null;
    
    try {
      const client = clientInfo.client;
      const chats = await client.getChats();
      const messages = [];
      
      // Get messages from all chats, up to 10 total
      for (const chat of chats) {
        if (messages.length >= 10) break;
        
        // Get messages from this chat
        const chatMessages = await chat.fetchMessages({ limit: 10 - messages.length });
        
        // Add messages to our array
        for (const msg of chatMessages) {
          messages.push({
            id: msg.id._serialized,
            from: msg.from,
            to: msg.to,
            body: msg.body,
            timestamp: msg.timestamp,
            fromMe: msg.fromMe,
            hasMedia: msg.hasMedia,
            type: msg.type
          });
          
          if (messages.length >= 10) break;
        }
      }
      
      // Sort messages by timestamp (newest first)
      messages.sort((a, b) => b.timestamp - a.timestamp);
      
      return messages.slice(0, 10); // Ensure we return at most 10 messages
    } catch (error) {
      console.error(`Error getting messages for ${clientId}:`, error);
      return null;
    }
  },

  /**
   * Get or initialize a client (attempting to restore session if possible)
   * @param {string} phoneNumber - Phone number in international format
   * @returns {Promise<{client: Object|null, authenticated: boolean, requiresQR: boolean, error: string|null}>}
   */
  getOrInitializeClient: async function(phoneNumber) {
    const clientId = this.formatPhoneNumber(phoneNumber);
    
    // If client already exists, return its status
    if (this.clients.has(clientId)) {
      const clientInfo = this.clients.get(clientId);
      return {
        client: clientInfo.client,
        authenticated: clientInfo.authenticated,
        requiresQR: false,
        error: null
      };
    }
    
    // Try to initialize the client
    try {
      const { qr, authenticated } = await this.getLoginQR(clientId);
      
      if (authenticated) {
        return {
          client: this.clients.get(clientId).client,
          authenticated: true,
          requiresQR: false,
          error: null
        };
      } else {
        // Session couldn't be restored, QR needed
        return {
          client: null,
          authenticated: false,
          requiresQR: true,
          error: 'Client requires QR authentication'
        };
      }
    } catch (error) {
      return {
        client: null,
        authenticated: false,
        requiresQR: false,
        error: `Failed to initialize client: ${error.message}`
      };
    }
  }
};

module.exports = whatsappManager;
