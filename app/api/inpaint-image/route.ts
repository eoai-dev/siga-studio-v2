import { NextResponse } from "next/server";
import Replicate from "replicate";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300; // Set timeout to 300 seconds (5 minutes)

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
    const { imageUrl, maskUrl, prompt } = await request.json();

    if (!imageUrl || !maskUrl) {
      return NextResponse.json(
        { error: "Image URL and mask URL are required" },
        { status: 400 }
      );
    }

    // Run inpainting model
    const output = await replicate.run(
      "zsxkib/flux-dev-inpainting:ca8350ff748d56b3ebbd5a12bd3436c2214262a4ff8619de9890ecc41751a008",
      {
        input: {
          image: imageUrl,
          mask: maskUrl,
          prompt: prompt,
          strength: 1,
          output_quality: 90
        }
      }
    );

    // Get the image URL from the output
    const inpaintedImageUrl = Array.isArray(output) ? output[0] : output.toString();

    // Fetch the image from Replicate
    const response = await fetch(inpaintedImageUrl);
    const imageBuffer = await response.arrayBuffer();

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `inpainted_${timestamp}.webp`;

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
    const { data: { publicUrl } } = supabase.storage
      .from("images")
      .getPublicUrl(filename);

    return NextResponse.json({ url: publicUrl });
  } catch (error) {
    console.error("Inpainting error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error occurred" },
      { status: 500 }
    );
  }
}
