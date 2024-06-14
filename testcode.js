const WebSocket = require("ws");

const ws = new WebSocket("ws://localhost:8080");

ws.on("open", () => {
  console.log("Connected to the server");

  // Simulate Twilio events
  ws.send(JSON.stringify({ event: "connected" }));

  ws.send(JSON.stringify({
    event: "start",
    streamSid: "1234"
  }));

  // Simulate sending media
  const payload = "simulated audio payload"; // Replace with actual base64 encoded audio payload
  ws.send(JSON.stringify({
    event: "media",
    media: {
      payload: Buffer.from(payload).toString('base64')
    }
  }));

  // End the call
  setTimeout(() => {
    ws.send(JSON.stringify({ event: "stop" }));
  }, 5000); // Adjust timeout as needed
});

ws.on("message", (message) => {
  console.log("Received message from server:", message);
});

ws.on("close", () => {
  console.log("Connection closed");
});

ws.on("error", (error) => {
  console.error("WebSocket error:", error);
});
