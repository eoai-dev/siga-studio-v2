import { NextResponse } from "next/server";

export async function POST() {
  try {
    // We need to check if we're using OpenAI or Groq
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(`OPENAI_API_KEY is not set`);
    }
    
    // We're still using OpenAI's realtime session API as Groq doesn't have a realtime equivalent
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          voice: "alloy",
          modalities: ["audio", "text"],
          instructions:
            "Start conversation with the user by saying 'Hello, how can I help you today?' Use the available tools when relevant. VERY IMPORTANT: all tools will only require what it says they require. If you see a tool, and it only needs the prompt don't cause problems by saying you need the image and the mask. Just run the tool. After executing a tool, you will need to respond (create a subsequent conversation item) to the user sharing the function result or error. If you do not respond with additional message with function result, user will not know you successfully executed the tool. Stay focused and concise - don't add unnecessary explanations or go off-topic. When dealing with URLs, don't read out the full address - just mention the website name or purpose. Speak and respond in the language of the user.",
          tool_choice: "auto",
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `API request failed with status ${JSON.stringify(response)}`
      );
    }

    const data = await response.json();

    // Return the JSON response to the client
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching session data:", error);
    return NextResponse.json(
      { error: "Failed to fetch session data" },
      { status: 500 }
    );
  }
}