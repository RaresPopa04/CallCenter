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

// <ake all the files in 'public' available
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


  const reserving = {};

  transcribeService.on("transcription",async (transcription) => {
    console.log(`Processing ${transcription}`);
    mediaStream.unpipe(audioStream);
    audioStream.unpipe(pcmStream);
    // const twiml = new TwilioClient.twiml.VoiceResponse();
    // twiml.say(
    //   {
    //     voice: "Polly.Brian",
    //     language: "en.GB",
    //   },
    //   transcription
    // );
    const twiml = new TwilioClient.twiml.VoiceResponse();


    if(!reserving[callSid]){ 
      reserving[callSid] = {
        state : "initial",
        data : {}
      }
    }

    const currentState = reserving[callSid].state;
    let question;

    switch(currentState){
      case "initial":
        question = `The client said ${transcription}. Is this a question for menu, reservation, or something else? Respond 1, 2 or 3.`;
        break;
      case "reservation_date":
        {
          let date = new Date();
          let localISOTime = (new Date(date.getTime() - (date.getTimezoneOffset() * 60000))).toISOString();
          question = `The client said to make a reservation for ${transcription}, now is ${localISOTime}. Please provide the date in yyyy-mm-dd format and include just the date.`;
          break;
        }
      case "reservation_time":
        let date = new Date();
        let localISOTime = (new Date(date.getTime() - (date.getTimezoneOffset() * 60000))).toISOString();
        question = `The client said to make a reservation on ${transcription}, now is ${localISOTime}. Please provide the time in hh:mm format, include only the time.`;
        break;
      case "reservation_confirmation":
        question = `The client said ${transcription}. Did he agree on the reservation? Respond yes or no.`;
        break;
      default:
        question = `The client said ${transcription}. Is this a question for menu, reservation, or something else? Respond in one word.`;
    }

    const response = await getResponse(question);
    console.log("Response: " + response);

    switch(currentState){
      case "initial":
        if (response == 1) {
          twiml.say(
            {
              voice: "Polly.Brian",
              language: "en.GB",
            },
            "Our menu includes: pizza, pasta, and salad. What would you like to order?"
          );
        } else if (response == 2) {
          twiml.say(
            {
              voice: "Polly.Brian",
              language: "en.GB",
            },
            "Sure, when would you like to make a reservation?"
          );
          reserving[callSid].state = "reservation_date";
        } else {
          twiml.say(
            {
              voice: "Polly.Brian",
              language: "en.GB",
            },
            "I'm sorry, I didn't understand. Could you please repeat that?"
          );
        }
        break;
        case "reservation_date":{
          const date = new Date(response);
          date.setHours(99,99,99,99);
          console.log(date);
          console.log(date.getDate()+ " "+ date.getMonth() + " "+ date.getFullYear());
          if(isNaN(date.getDate()) || date < new Date() || isNaN(date.getMonth()) || isNaN(date.getFullYear()) || date.getDate() > 31 || date.getMonth() > 12){
            twiml.say(
              {
                voice: "Polly.Brian",
                language: "en.GB",
              },
              "I'm sorry, I didn't understand the date. Please repeat the date."
            );
            break;
            
          }

          reserving[callSid].data.date = date;
          twiml.say(
            {
              voice: "Polly.Brian",
              language: "en.GB",
            },
            "At what time would you like to make the reservation?"
          );
          reserving[callSid].state = "reservation_time";
          break;
        }
          
        case "reservation_time":

          const time = response.split(":");
          if(isNaN(time[0]) || time[0] > 24 || time[0] < 0 || isNaN(time[1]) || time[1] > 60 || time[1] < 0){
            twiml.say(
              {
                voice: "Polly.Brian",
                language: "en.GB",
              },
              "I'm sorry, I didn't understand the time. Please repeat the time."

            );
            break;
          }


          reserving[callSid].data.time = response;
          const date = reserving[callSid].data.date;
          const day = date.getDate();
          const month = date.getMonth();
          const year = date.getFullYear();

          twiml.say(
            {
              voice: "Polly.Brian",
              language: "en.GB",
            },
            `You want to make a reservation on ${day + " "+month+" "+year} at ${reserving[callSid].data.time}. Is this correct?`
          );
          reserving[callSid].state = "reservation_confirmation";
        break;
        case "reservation_confirmation":
          if (response.toLowerCase().includes("yes")) {
            twiml.say(
              {
                voice: "Polly.Brian",
                language: "en.GB",
              },
              `Your reservation is confirmed for ${reserving[callSid].data.date} at ${reserving[callSid].data.time}. Thank you!`
            );
            reserving[callSid] = null;
          } else {
            twiml.say(
              {
                voice: "Polly.Brian",
                language: "en.GB",
              },
              "Let's try again. Please provide the date in dd/mm/yyyy format."
            );
            reserving[callSid].state = "reservation_date";
          }
        break;
    }
      
    
    twiml.pause({ length: 120 });
    client.calls(callSid).update({
    twiml: twiml.toString(),
    });

    mediaStream.pipe(audioStream).pipe(pcmStream);

  });

  mediaStream.on("close", () => {
    transcribeService.stop();
  });
});

app.use(function(err, req, res, next) {
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

const client = new openAI.OpenAI({
    apiKey: process.env.OPENAI_API_KEY
    });

async function getResponse(prompt) {
    try {
      console.log("Prompt: "+prompt);
        const completions = await client.chat.completions.create({
            messages:[
                {
                    role:'system',
                    content:prompt
                }
            ],
            model: 'gpt-3.5-turbo',
            max_tokens: 50
        })
        return completions.choices[0].message.content;
    } catch (error) {
        console.error("GPT " +error);
    }
}

