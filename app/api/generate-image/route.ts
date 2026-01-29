import { NextResponse } from "next/server";
import Replicate from "replicate";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300; // 5 minutes

// Initialize Replicate
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Initialize Supabase with service role key for server-side operations
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Generate image using Replicate
    const output = await replicate.run("black-forest-labs/flux-dev", {
      input: {
        prompt: body.prompt,
        guidance: body.guidance || 3.5,
        output_format: "jpg",
        go_fast: true,
      },
    });

    console.log("Replicate output:", output);

    // Get the image URL from the output array
    const imageUrl = Array.isArray(output) ? output[0] : output.toString();

    // Fetch the image from the Replicate URL
    const response = await fetch(imageUrl);
    const imageBuffer = await response.arrayBuffer();

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `generated_${timestamp}.webp`;

    // Upload to Supabase Storage
    const { error } = await supabase.storage
      .from("images")
      .upload(filename, Buffer.from(imageBuffer), {
        contentType: "image/webp",
        cacheControl: "3600",
      });

    if (error) {
      throw error;
    }

    // Get the public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("images").getPublicUrl(filename);

    return NextResponse.json([{ url: publicUrl }]);
  } catch (error) {
    console.error("Image generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate image" },
      { status: 500 }
    );
  }
}
