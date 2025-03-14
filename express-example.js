const express = require('express');
const bodyParser = require('body-parser');
const whatsappManager = require('./whatsappManager');
const qrcode = require('qrcode-terminal');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Initialize WhatsApp Manager
whatsappManager.initialize();

// Store the active phone number
let activePhoneNumber = null;

// Routes

// Status endpoint
app.get('/status', async (req, res) => {
  if (!activePhoneNumber) {
    return res.json({
      status: 'disconnected',
      phoneNumber: null
    });
  }
  
  try {
    // Try to get or initialize the client
    const { authenticated, requiresQR, error } = await whatsappManager.getOrInitializeClient(activePhoneNumber);
    
    res.json({
      status: authenticated ? 'connected' : 'disconnected',
      phoneNumber: activePhoneNumber,
      requiresQR: requiresQR,
      error: error
    });
  } catch (error) {
    console.error('Error checking status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get QR code endpoint
app.get('/qr', async (req, res) => {
  try {
    // Get phone number from query
    const phoneNumber = req.query.phone;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required. Use /qr?phone=1234567890'
      });
    }
    
    // Store the phone number
    activePhoneNumber = phoneNumber;
    
    // Directly get the QR code or authentication status
    console.log(`Getting QR code for phone number ${phoneNumber}...`);
    const { qr, authenticated, clientId } = await whatsappManager.getLoginQR(phoneNumber);
    
    if (authenticated) {
      return res.json({ 
        success: true, 
        authenticated: true,
        message: 'Already authenticated' 
      });
    } else if (qr) {
      // Display QR code in terminal for convenience
      console.log('Scan this QR code with your WhatsApp app:');
      qrcode.generate(qr, { small: true });
      
      return res.json({ 
        success: true, 
        authenticated: false,
        qr: qr,
        message: 'QR code generated successfully' 
      });
    } else {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to generate QR code' 
      });
    }
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Check authentication status endpoint
app.get('/auth-status', async (req, res) => {
  if (!activePhoneNumber) {
    return res.status(400).json({
      success: false,
      error: 'No phone number has been set. Use /qr?phone=1234567890 first.'
    });
  }
  
  try {
    // Try to get or initialize the client
    const { authenticated, requiresQR, error } = await whatsappManager.getOrInitializeClient(activePhoneNumber);
    
    // No need to set up message listener
    
    res.json({ 
      success: true, 
      authenticated: authenticated,
      requiresQR: requiresQR,
      error: error,
      phoneNumber: activePhoneNumber
    });
  } catch (error) {
    console.error('Error checking authentication status:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});


// Get last 10 messages endpoint
app.get('/last10messages/:phoneNumber', async (req, res) => {
  const { phoneNumber } = req.params;
  
  if (!phoneNumber) {
    return res.status(400).json({ 
      success: false, 
      error: 'Phone number is required' 
    });
  }
  
  try {
    // Try to get or initialize the client
    const { authenticated, requiresQR, error } = await whatsappManager.getOrInitializeClient(phoneNumber);
    
    if (!authenticated) {
      return res.status(400).json({ 
        success: false, 
        error: error,
        requiresQR: requiresQR
      });
    }
    
    // Client is authenticated, get messages
    const messages = await whatsappManager.getLast10Messages(phoneNumber);
    
    if (!messages) {
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve messages'
      });
    }
    
    res.json({
      success: true, 
      messages: messages
    });
  } catch (error) {
    console.error('Error retrieving messages:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Send message between clients endpoint
app.post('/send-message', async (req, res) => {
  const { senderPhoneNumber, recipientPhoneNumber, message } = req.body;
  
  if (!senderPhoneNumber || !recipientPhoneNumber || !message) {
    return res.status(400).json({ 
      success: false, 
      error: 'Sender phone number, recipient phone number, and message are required' 
    });
  }
  
  try {
    // Try to get or initialize the sender client
    const { authenticated, requiresQR, error } = await whatsappManager.getOrInitializeClient(senderPhoneNumber);
    
    if (!authenticated) {
      return res.status(400).json({ 
        success: false, 
        error: error,
        requiresQR: requiresQR
      });
    }
    
    // Sender client is authenticated, send the message
    const result = await whatsappManager.sendMessage(
      senderPhoneNumber, 
      recipientPhoneNumber, 
      message
    );
    
    if (!result) {
      return res.status(500).json({
        success: false,
        error: 'Failed to send message'
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Message sent successfully'
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Logout endpoint
app.post('/logout', async (req, res) => {
  // Get phone number from query
  const phoneNumber = req.query.phone;
  
  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      error: 'Phone number is required. Use /logout?phone=1234567890'
    });
  }
  
  try {
    // Try to get or initialize the client
    const { authenticated, requiresQR, error } = await whatsappManager.getOrInitializeClient(phoneNumber);
    
    if (!authenticated) {
      return res.status(400).json({ 
        success: false, 
        error: error,
        requiresQR: requiresQR
      });
    }
    
    // Client is authenticated, logout
    const result = await whatsappManager.logout(phoneNumber);
    
    res.json({ 
      success: result, 
      message: result ? 'Logged out successfully' : 'Failed to logout'
    });
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Message listener function removed as requested

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('WhatsApp Manager initialized. Use /qr?phone=1234567890 endpoint to get a QR code for login.');
});

// Handle process termination
process.on('SIGINT', async () => {
  if (activePhoneNumber) {
    try {
      // Try to get or initialize the client
      const { authenticated } = await whatsappManager.getOrInitializeClient(activePhoneNumber);
      
      if (authenticated) {
        console.log('Logging out WhatsApp client...');
        await whatsappManager.logout(activePhoneNumber);
      }
    } catch (error) {
      console.error('Error during logout on termination:', error);
    }
  }
  process.exit(0);
});
