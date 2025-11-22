const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.static('public'));

// Initialize database
const db = new sqlite3.Database('chat_history.db');

db.serialize(() => {
    // Create messages table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT
    )`);
    
    // Create user statistics table
    db.run(`CREATE TABLE IF NOT EXISTS user_stats (
        username TEXT PRIMARY KEY,
        message_count INTEGER DEFAULT 1,
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Webhook endpoint for Roblox to send messages to
app.post('/api/webhook', (req, res) => {
    const { username, message } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    
    if (!username || !message) {
        return res.status(400).json({ error: 'Username and message are required' });
    }

    // Insert message into database
    const stmt = db.prepare('INSERT INTO messages (username, message, ip_address) VALUES (?, ?, ?)');
    stmt.run(username, message, ip, function(err) {
        if (err) {
            console.error('Error saving message:', err);
            return res.status(500).json({ error: 'Failed to save message' });
        }
        
        // Update user statistics
        db.run(`
            INSERT INTO user_stats (username, message_count, last_seen) 
            VALUES (?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(username) DO UPDATE SET 
                message_count = message_count + 1,
                last_seen = CURRENT_TIMESTAMP
        `, [username]);

        res.status(200).json({ success: true, message: 'Message received' });
    });
    
    stmt.finalize();
});

// API endpoints for the dashboard
app.get('/api/messages', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    db.all(
        'SELECT * FROM messages ORDER BY timestamp DESC LIMIT ? OFFSET ?', 
        [limit, offset], 
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        }
    );
});

app.get('/api/stats', (req, res) => {
    const stats = {};
    
    // Get total messages
    db.get('SELECT COUNT(*) as count FROM messages', (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        stats.totalMessages = row.count;
        
        // Get total users
        db.get('SELECT COUNT(DISTINCT username) as count FROM messages', (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            stats.totalUsers = row.count;
            
            // Get messages per day
            db.all(`
                SELECT 
                    DATE(timestamp) as date, 
                    COUNT(*) as count 
                FROM messages 
                GROUP BY date 
                ORDER BY date DESC 
                LIMIT 30
            `, (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                stats.messagesPerDay = rows;
                
                // Get top users
                db.all(`
                    SELECT 
                        username, 
                        message_count as count,
                        last_seen
                    FROM user_stats 
                    ORDER BY message_count DESC 
                    LIMIT 10
                `, (err, rows) => {
                    if (err) return res.status(500).json({ error: err.message });
                    stats.topUsers = rows;
                    
                    res.json(stats);
                });
            });
        });
    });
});

// Serve the dashboard
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
