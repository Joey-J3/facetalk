import { createServer } from 'node:http'
import express from 'express'
import { Server } from 'socket.io'
import cluster from 'node:cluster'
import { availableParallelism } from 'node:os';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (cluster.isPrimary) {
  const numCPUS = availableParallelism()
  console.log('Counts of the cpu:', numCPUS);
  for (let i = 0; i < numCPUS; i++) {
    cluster.fork({
      PORT: 3000 + i
    })
  }

  setupPrimary()
} else {
  const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  })

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_offset TEXT UNIQUE,
      content TXT
    )
  `)

  const app = express()
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {},
    adapter: createAdapter()
  })

  const __dirname = dirname(fileURLToPath(import.meta.url))
  
  app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
  });
  
  io.on('connection', (socket) => {
    socket.on('chat message', async (msg, client_offset, callback) => {
      let result
      try {
        result = await db.run(`INSERT INTO messages (content, client_offset) VALUES (?, ?)`, msg, client_offset)
      } catch (error) {
        if (error.errno === 19) {
          callback()
        } else {}
        return
      }
      console.log(`message: ${msg}`);
      io.emit('chat message', msg, result.lastID)
    })
    socket.on('disconnect', (reason) => {
      console.log('a user disconnected:', reason);
    })

    if (!socket.recovered) {
      try {
        db.each(`SELECT id content FROM messages WHERE id > ?`, [socket.handshake.auth.serverOffset || 0], (err, row) => {
          socket.emit('chat message', row.content, row.id)
        })
      } catch (error) {
        
      }
    }
  })

  const port = process.env.PORT || 3000
  
  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}
