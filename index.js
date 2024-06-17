require("dotenv").config();
const express = require("express");
const hbs = require("express-handlebars");
const expressWebSocket = require("express-ws");
const Transform = require("stream").Transform;
const websocketStream = require("websocket-stream/stream");
const WaveFile = require("wavefile").WaveFile;
const AmazonTranscribeService = require("./transcribe-service");
const TwilioClient = require("twilio");

const app = express();
// extend express app with app.ws()
expressWebSocket(app, null, {
  perMessageDeflate: false,
});
app.engine("hbs", hbs());
app.set("view engine", "hbs");

// Make all the files in 'public' available
app.use(express.static("public"));
app.get("/", (request, response) => {
  response.render("home", { number: process.env.TWILIO_NUMBER, layout: false });
});

// Responds with Twilio instructions to begin the stream
app.post("/", (request, response) => {
  response.setHeader("Content-Type", "application/xml");
  response.render("twiml", { host: request.hostname, layout: false });
});

app.ws("/media", (ws, req) => {
  // Audio Stream coming from Twilio
  const mediaStream = websocketStream(ws);
  let callSid;
  const client = new TwilioClient();
  const audioStream = new Transform({
    transform: (chunk, encoding, callback) => {
      const msg = JSON.parse(chunk.toString("utf8"));
      if (msg.event === "start") {
        callSid = msg.start.callSid;
        console.log(`Captured call ${callSid}`);
      }
      // Only process media messages
      if (msg.event !== "media") return callback();
      // This is mulaw
      return callback(null, Buffer.from(msg.media.payload, "base64"));
    },
  });
  const pcmStream = new Transform({
    transform: (chunk, encoding, callback) => {
      const wav = new WaveFile();
      wav.fromScratch(1, 8000, "8m", chunk);
      wav.fromMuLaw();
      return callback(null, Buffer.from(wav.data.samples));
    },
  });

  const transcribeService = new AmazonTranscribeService(pcmStream);

  // Pipe our streams together
  mediaStream.pipe(audioStream).pipe(pcmStream);

  const conversationContext = {};

  transcribeService.on("transcription", async (transcription) => {
    console.log(`Processing ${transcription}`);
    mediaStream.unpipe(audioStream);
    audioStream.unpipe(pcmStream);

    const twiml = new TwilioClient.twiml.VoiceResponse();
    const twilSay = await processConversation(transcription, callSid);
    twiml.say(
      {
        voice: "Polly.Brian",
        language: "en.GB",
      },
      twilSay
    );

    client.calls(callSid).update({
      twiml: twiml.toString(),
    });

    mediaStream.pipe(audioStream).pipe(pcmStream);
  });

  mediaStream.on("close", () => {
    transcribeService.stop();
  });
});

app.use(function (err, req, res, next) {
  console.trace(err);
  res.status(err.status || 500);
  res.send({
    message: err.message,
    error: {},
  });
});

const listener = app.listen(8080, () => {
  console.log("Your app is listening on port " + listener.address().port);
});

const openAI = require('openai');
const { ReservationContext } = require("twilio/lib/rest/taskrouter/v1/workspace/task/reservation");

const client = new openAI.OpenAI({
  apiKey: ,
});

async function getResponse(prompt) {
  try {
    const completions = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant for a restaurant. The user wants to make a reservation. Help them make a reservation. Talk in Romanian and analyze the context. Do not assume anything, just read the conversation and respond based on the given context.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: 'gpt-3.5-turbo',
      max_tokens: 150,
    });
    return completions.choices[0].message.content;
  } catch (error) {
    console.error("GPT " + error);
    return "A apărut o eroare în procesarea cererii tale. Te rog încearcă din nou.";
  }
}

const conversationContext = {};

const processConversation = async (transcription, callSid) => {
  if (!conversationContext[callSid]) {
    conversationContext[callSid] = {
      history: [],
      reservation: {
        date: null,
        time: null,
        people: null,
        name: null,
      },
    };
  }

  const context = conversationContext[callSid];
  context.history.push({ role: 'user', content: transcription });

  const prompt = context.history.map(entry => `${entry.role}: ${entry.content}`).join('\n');
  const response = await getResponse(prompt);

  context.history.push({ role: 'assistant', content: response });

  // Extract reservation details from the response
  await extractReservationDetails(transcription, context.reservation);

  console.log(context.reservation);
  
  // Check if we have all necessary information to make a reservation
  if (context.reservation.date && context.reservation.time && context.reservation.people && context.reservation.name) {
    context.reservation.confirmed = true;
    makeReservation(callSid, context.reservation);
    return "Rezervarea a fost realizată cu succes. Mulțumim!";
  }
  return response;
};

const getFilteredResponse = async (response) => {
  try {
    console.log("Response: " + response);
    const question = `This is a client's request: ${response}.
    Today is ${new Date().toLocaleDateString()} and the time is ${new Date().toLocaleTimeString()}. This is just for refference in the response, do not use it if not needed. To be used in case the client's request for a date like tomorrow or next week.
    The client's response is in Romanian, this means that 'maine' means tomorrow.
    Give a response based on the client's request, do not assume anything. Use and empty string if you do not have any information to provide.
    Return a json like {
      "date": "dd-mm-yyyy",
      "time": "hh:mm",
      "people": "number persoane",
      "name": "Numele meu este {the name provided}"
    }.
    Do not respond anything else than requested and do not assume anything.`;

    const completions = await client.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: question,
        },
      ],
      model: 'gpt-3.5-turbo',
      max_tokens: 150,
    });
    return completions.choices[0].message.content;
  } catch (error) {
    console.error("GPT " + error);
    return "A apărut o eroare în procesarea cererii tale. Te rog încearcă din nou.";
  }
}

const extractReservationDetails = async (response, reservation) => {
  const filteredResponse = await getFilteredResponse(response);
  console.log("Filtered response: " + filteredResponse);

  const dateRegex = /\b(\d{2}-\d{2}-\d{4})\b/;
  const timeRegex = /\b(\d{2}:\d{2})\b/;
  const peopleRegex = /(\d+)\s+persoane\b/;
  const nameRegex = /Numele meu este\s+(\w+)/i;

  const dateMatch = filteredResponse.match(dateRegex);
  const timeMatch = filteredResponse.match(timeRegex);
  const peopleMatch = filteredResponse.match(peopleRegex);
  const nameMatch = filteredResponse.match(nameRegex);

  if (dateMatch) reservation.date = dateMatch[1];
  if (timeMatch) reservation.time = timeMatch[1];
  if (peopleMatch) reservation.people = peopleMatch[1];
  if (nameMatch) reservation.name = nameMatch[1];
};

const makeReservation = (callSid, reservation) => {
  // Implement the logic to make the reservation
  console.log(`Making reservation for call ${callSid}:`, reservation);
};

// Example usage
(async () => {
  const response1 = await processConversation("Vreau să fac o rezervare pentru 3 persoane.", "call123");
  console.log(response1);


  const response3 = await processConversation("Numele meu este Andrei.", "call123");
  console.log(response3);

  const response2 = await processConversation("Mâine", "call123");
  console.log(response2);

  const response4 = await processConversation("Pe la 2:30", "call123");
  console.log(response4);
})();