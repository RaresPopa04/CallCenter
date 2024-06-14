const WebSocket = require("ws");
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });
const axios = require("axios");
const path = require("path");
require("dotenv").config();

const speech = require("@google-cloud/speech");
const client = new speech.SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

// Configure Transcription Request
const request = {
  config: {
    encoding: "MULAW",
    sampleRateHertz: 8000,
    languageCode: "en-GB",
  },
  interimResults: true,
};

let headers = "";
const callerTexts = {};
let streamSids = [];
let connectionCount = 0;

wss.on("connection", function connection(ws) {
  let callerText = "";
  let streamSid = "";
  console.log("New Connection Initiated");

  let recognizeStream = null;

  ws.on("message", function incoming(message) {
    const msg = JSON.parse(message);
    switch (msg.event) {
      case "connected":
        console.log(`A new call has connected.`);
        break;
      case "start":
        console.log(`Starting Media Stream ${msg.streamSid}`);
        streamSid = msg.streamSid;
        recognizeStream = client
          .streamingRecognize(request)
          .on("error", console.error)
          .on("data", (data) => {
            if (data.results[0] && data.results[0].isFinal) {
              console.log(data.results[0].alternatives[0].transcript);
              callerText += data.results[0].alternatives[0].transcript;
            }
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(
                  JSON.stringify({
                    event: "interim-transcription",
                    text: data.results[0].alternatives[0].transcript,
                  })
                );
              }
            });
          });
        break;
      case "media":
        if (recognizeStream) {
          recognizeStream.write(Buffer.from(msg.media.payload, "base64"));
        }
        break;
      case "stop":
        if (recognizeStream) {
          recognizeStream.end();
          callerTexts[streamSid] = callerText;
        }
        break;
    }
  });

  ws.on("close", () => {
    if (recognizeStream) {
      recognizeStream.end();
    }
  });
});

app.use(express.json());

app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "/index.html")));

app.post("/", (req, res) => {
  connectionCount++;
  headers = req.headers.host;
  console.log(req.body);
  res.set("Content-Type", "text/xml");
  res.send(`
    <Response>
      <Start>
        <Stream url="wss://${req.headers.host}/"/>
      </Start>
      <Say>Hi</Say>
      <Pause length="4" />
      <Redirect method="POST">/next-response?streamSid=${req.body.StreamSid}</Redirect>
    </Response>
  `);
});

app.post("/next-response", (req, res) => {
  console.log(req.query);
  const streamSid = req.query.streamSid;
  console.log(streamSid);
  const callerText = callerTexts[streamSid];
  console.log(callerText);
  res.set("Content-Type", "text/xml");
  res.send(`
    <Response>
      <Say>Hi, I'm the next response. You said: ${callerText}</Say>
    </Response>
  `);
});

console.log("Listening on Port 8080");
server.listen(8080);
