import { exec } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import voice from "elevenlabs-node";
import express from "express";
import { promises as fs } from "fs";
import OpenAI from "openai";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "-",
});

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceID = "ymu001dDcWSSzffANts3";

const app = express();
app.use(express.json());

const allowedOrigins = [
  "https://virtual-mentor-frontend.vercel.app",
  "https://virtual-mentor-frontend.vercel.app/",
  "http://localhost:5173",
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
}));

const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/voices", async (req, res) => {
  res.send(await voice.getVoices(elevenLabsApiKey));
});

const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
};

const lipSyncMessage = async (message) => {
  const time = new Date().getTime();
  console.log(`Starting conversion for message ${message}`);

  const tempPath = os.tmpdir();
  const inputAudioPath = path.join(tempPath, `message_${message}.mp3`);
  const outputAudioPath = path.join(tempPath, `message_${message}.wav`);
  const outputPathJson = path.join(tempPath, `message_${message}.json`);

  await execCommand(
    `ffmpeg -y -i ${inputAudioPath} ${outputAudioPath}`
  );
  console.log(`Conversion done in ${new Date().getTime() - time}ms`);

  const rhubarbPath = path.join(__dirname, "bin", "rhubarb.exe");
  await execCommand(
    `"${rhubarbPath}" -f json -o ${outputPathJson} ${outputAudioPath} -r phonetic`
  );
  console.log(`Lip sync done in ${new Date().getTime() - time}ms`);
};

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  if (!userMessage) {
    // You should generate these intro files or remove this section
    // For now, let's send a simple text response.
    res.send({
      messages: [{
        text: "Hello! How can I help you today?",
        facialExpression: "smile",
        animation: "Talking_1",
        audio: null, // No pre-recorded audio
        lipsync: null,
      }, ],
    });
    return;
  }

  if (!elevenLabsApiKey || openai.apiKey === "-") {
    res.status(400).send({
      error: "API keys are not configured on the server."
    });
    return;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo-1106",
      max_tokens: 1000,
      temperature: 0.6,
      response_format: {
        type: "json_object",
      },
      messages: [{
        role: "system",
        content: `
        You are a virtual mentor for kids of age 6-18.
        You will always reply with a JSON array of messages. With a maximum of 3 messages.
        Each message has a text, facialExpression, and animation property.
        The different facial expressions are: smile, sad, angry, surprised, funnyFace, and default.
        The different animations are: Talking_0, Talking_1, Talking_2, Crying, Laughing, Rumba, Idle, Terrified, and Angry. 
        `,
      }, {
        role: "user",
        content: userMessage || "Hello",
      }, ],
    });

    let messages = JSON.parse(completion.choices[0].message.content);
    if (messages.messages) {
      messages = messages.messages;
    }

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const tempPath = os.tmpdir();
      const fileName = path.join(tempPath, `message_${i}.mp3`);
      const textInput = message.text;

      await voice.textToSpeech(elevenLabsApiKey, voiceID, fileName, textInput);
      await lipSyncMessage(i);

      const audioFilePath = path.join(tempPath, `message_${i}.mp3`);
      const lipsyncFilePath = path.join(tempPath, `message_${i}.json`);

      message.audio = await audioFileToBase64(audioFilePath);
      message.lipsync = await readJsonTranscript(lipsyncFilePath);
    }

    res.send({
      messages
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      error: "An error occurred while processing your request."
    });
  }
});

const readJsonTranscript = async (file) => {
  const data = await fs.readFile(file, "utf8");
  return JSON.parse(data);
};

const audioFileToBase64 = async (file) => {
  const data = await fs.readFile(file);
  return data.toString("base64");
};

app.listen(port, () => {
  console.log(`Virtual Mentor listening on port ${port}`);
});