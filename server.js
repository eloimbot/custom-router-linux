// server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dgram = require('dgram');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const UDP_PORT = 4000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname,'public')));

// --- SQLite init ---
const db = new Database(path.join(__dirname,'controller.db'));

// Create tables if not exist
db.prepare(`CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, name TEXT, status TEXT, vlan INTEGER, clients INTEGER, traffic INTEGER, lastSeen INTEGER
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, ap_id TEXT, ip TEXT, lastSeen INTEGER
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS vlans (
  id INTEGER PRIMARY KEY, ssid TEXT
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS vlans_aps ( vlan_id INTEGER, ap_id TEXT )`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS events ( id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, level TEXT, msg TEXT )`).run();

// helpers
const now = () => Date.now();
function logEvent(level, msg){
  db.prepare('INSERT INTO events(ts,level,msg) VALUES(?,?,?)').run(now(), level, msg);
  io.emit('event', {ts: now(), level, msg});
}

// --- REST API ---
// List devices
app.get('/api/devices', (req,res)=>{
  const rows = db.prepare('SELECT * FROM devices').all();
  res.json(rows);
});

// Get one device
app.get('/api/devices/:id', (req,res)=>{
  const d = db.prepare('SELECT * FROM devices WHERE id=?').get(req.params.id);
  if(!d) return res.status(404).send('Not found');
  res.json(d);
});

// Adopt device (manual)
app.post('/api/devices/adopt', (req,res)=>{
  const {id,name} = req.body;
  if(!id||!name) return res.status(400).send('id and name required');
  const exists = db.prepare('SELECT 1 FROM devices WHERE id=?').get(id);
  if(exists) return res.status(400).send('already exists');
  db.prepare('INSERT INTO devices(id,name,status,clients,traffic,lastSeen) VALUES(?,?,?,?,?,?)')
    .run(id,name,'online',0,0, now());
  logEvent('info', `AP adopted: ${id}`);
  io.emit('devices:update');
  res.sendStatus(200);
});

// Update device config (assign VLAN)
app.post('/api/devices/:id/config', (req,res)=>{
  const id = req.params.id;
  const {vlan} = req.body;
  const dev = db.prepare('SELECT * FROM devices WHERE id=?').get(id);
  if(!dev) return res.status(404).send('device not found');
  db.prepare('UPDATE devices SET vlan=?, lastSeen=? WHERE id=?').run(vlan||null, now(), id);
  // update vlans_aps relation (remove old, add new)
  if(vlan){
    db.prepare('INSERT OR IGNORE INTO vlans_aps(vlan_id, ap_id) VALUES(?,?)').run(vlan, id);
  }
  logEvent('info', `VLAN ${vlan} assigned to ${id}`);
  io.emit('devices:update');
  // notify agent: send UDP push to device IP? We keep a record of last sender address below and emit via socket
  io.emit('push:config', {id, vlan});
  res.sendStatus(200);
});

// Create VLAN
app.post('/api/vlan', (req,res)=>{
  const {id, ssid, aps} = req.body;
  if(!id||!ssid) return res.status(400).send('missing fields');
  db.prepare('INSERT OR REPLACE INTO vlans(id, ssid) VALUES(?,?)').run(id, ssid);
  if(Array.isArray(aps)){
    // remove existing entries for this vlan
    db.prepare('DELETE FROM vlans_aps WHERE vlan_id=?').run(id);
    const ins = db.prepare('INSERT INTO vlans_aps(vlan_id, ap_id) VALUES(?,?)');
    const trans = db.transaction((items)=>{ items.forEach(a=>ins.run(id,a)); });
    trans(aps);
  }
  logEvent('info', `VLAN created ${id}`);
  io.emit('vlans:update');
  res.sendStatus(200);
});

// clients, vlans, events endpoints
app.get('/api/clients', (req,res)=> res.json(db.prepare('SELECT * FROM clients ORDER BY lastSeen DESC').all()));
app.get('/api/vlans', (req,res)=> {
  const rows = db.prepare('SELECT * FROM vlans').all();
  const out = rows.map(r=>{
    const aps = db.prepare('SELECT ap_id FROM vlans_aps WHERE vlan_id=?').all(r.id).map(x=>x.ap_id);
    return {...r, aps};
  });
  res.json(out);
});
app.get('/api/logs', (req,res)=> res.json(db.prepare('SELECT * FROM events ORDER BY ts DESC LIMIT 200').all()));

// --- UDP listener: AP telemetry and agent responses
const udp = dgram.createSocket('udp4');
// track last sender IP/port per device to push config if needed
const lastSender = {}; // { deviceId: {ip,port,ts} }

udp.on('message', (msg, rinfo) => {
  let data;
  try{
    data = JSON.parse(msg.toString());
  }catch(e){
    logEvent('warn', `UDP parse error from ${rinfo.address}:${rinfo.port}`);
    return;
  }
  if(!data.id){ logEvent('warn','UDP packet missing id'); return; }
  // upsert device
  const exists = db.prepare('SELECT 1 FROM devices WHERE id=?').get(data.id);
  if(exists){
    db.prepare('UPDATE devices SET name=?, status=?, clients=?, traffic=?, lastSeen=? WHERE id=?')
      .run(data.name||data.id, data.status||'online', data.clients||0, data.traffic||0, now(), data.id);
  } else {
    db.prepare('INSERT INTO devices(id,name,status,clients,traffic,lastSeen) VALUES(?,?,?,?,?,?)')
      .run(data.id, data.name||data.id, data.status||'online', data.clients||0, data.traffic||0, now());
  }
  // optional: update clients table (if agent sends clients list)
  if(Array.isArray(data.clients_list)){
    const del = db.prepare('DELETE FROM clients WHERE ap_id=?').run(data.id);
    const ins = db.prepare('INSERT INTO clients(name, ap_id, ip, lastSeen) VALUES(?,?,?,?)');
    const tx = db.transaction((items)=>{
      items.forEach(c => ins.run(c.name || 'client', data.id, c.ip || null, now()));
    });
    tx(data.clients_list);
  }

  lastSender[data.id] = { ip: rinfo.address, port: rinfo.port, ts: now() };

  logEvent('debug', `Telemetry from ${data.id} @ ${rinfo.address}:${rinfo.port}`);
  io.emit('telemetry', { id: data.id, name: data.name, clients: data.clients, traffic: data.traffic, status: data.status });
});

udp.bind(UDP_PORT, () => {
  console.log(`UDP server listening on ${UDP_PORT}`);
});

// --- WebSocket real-time: notify clients on connection
io.on('connection', (socket) => {
  console.log('WS client connected');
  socket.emit('ready', { ts: now() });
});

// cleanup offline devices by lastSeen
setInterval(()=>{
  const thresh = now() - 30_000; // 30s
  const rows = db.prepare('SELECT id, lastSeen FROM devices').all();
  rows.forEach(r=>{
    if(r.lastSeen < thresh){
      db.prepare('UPDATE devices SET status=? WHERE id=?').run('offline', r.id);
      io.emit('devices:update');
    }
  });
},5000);

// start server
server.listen(PORT, ()=> {
  console.log(`HTTP+WS server running at http://localhost:${PORT}`);
  logEvent('info', 'Controller started');
});
