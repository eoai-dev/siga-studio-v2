"use client";

import React, { useEffect, useState } from "react";
import useWebRTCAudioSession from "@/hooks/use-webrtc";
import { tools } from "@/lib/tools";
import { VoiceSelector } from "@/components/voice-select";
import { BroadcastButton } from "@/components/broadcast-button";
import { StatusDisplay } from "@/components/status";
import { MessageControls } from "@/components/message-controls";
import { TextInput } from "@/components/text-input";
import { motion } from "framer-motion";
import { useToolsFunctions } from "@/hooks/use-tools";
import { MaskDisplay } from "@/components/mask-display";
import { ImageDisplay } from "@/components/image-display";
import { Header } from "@/components/header";
import { useImageStore } from "@/lib/stores/image-store";
import { LoadingOverlay } from "@/components/loading-overlay";
import { HelpDialog } from "@/components/help-dialog";
import { AnimatedLogo } from "@/components/ui/animated-logo";

const App: React.FC = () => {
  const [voice, setVoice] = useState("ash");
  const [showInitialLoad, setShowInitialLoad] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowInitialLoad(false);
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  const {
    status,
    isSessionActive,
    isMicMuted,
    registerFunction,
    handleStartStopClick,
    toggleMic,
    conversation,
    sendTextMessage,
  } = useWebRTCAudioSession(voice, tools);

  const { showHelpDialog, setShowHelpDialog, ...toolsFunctions } =
    useToolsFunctions(setVoice);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Broadcast shortcut (Cmd/Ctrl + B)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        handleStartStopClick();
      }

      // Mic toggle shortcut (Cmd/Ctrl + M)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "m") {
        event.preventDefault();
        if (isSessionActive) {
          toggleMic();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleStartStopClick, isSessionActive, toggleMic]);

  useEffect(() => {
    Object.entries(toolsFunctions).forEach(([name, func]) => {
      const functionNames: Record<string, string> = {
        timeFunction: "getCurrentTime",
        backgroundFunction: "changeBackgroundColor",
        partyFunction: "partyMode",
        sparkleFunction: "sparkleMode",
        launchWebsite: "launchWebsite",
        copyToClipboard: "copyToClipboard",
        scrapeWebsite: "scrapeWebsite",
        generateImage: "generateImage",
        createImageMask: "createImageMask",
        inpaintImage: "inpaintImage",
        changeVoice: "changeVoice",
        restartSession: "restartSession",
        clearMask: "clearMask",
        showHelp: "showHelp",
        closeHelp: "closeHelp",
        explainSiga: "explainSiga",
      };

      registerFunction(functionNames[name], func);
    });
  }, [registerFunction, toolsFunctions]);

  useEffect(() => {
    // Only start the warm-up interval if the session is active
    if (isSessionActive) {
      // Initial warm-up
      fetch("/api/warmup", { method: "POST" }).catch((err) =>
        console.error("Warm-up error:", err)
      );

      // Set up interval for subsequent warm-ups (every 5 minutes)
      const warmupInterval = setInterval(() => {
        fetch("/api/warmup", { method: "POST" }).catch((err) =>
          console.error("Warm-up error:", err)
        );
      }, 1 * 60 * 1000); // 5 minutes

      // Cleanup interval when session ends or component unmounts
      return () => clearInterval(warmupInterval);
    }
  }, [isSessionActive]); // Depend on isSessionActive to start/stop warm-up

  if (showInitialLoad) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <div className="text-2xl font-bold text-center">
          <AnimatedLogo className="h-24 w-auto" />
        </div>
      </div>
    );
  }

  return (
    <main className="h-[calc(100vh)] w-full flex flex-col">
      <HelpDialog open={showHelpDialog} onOpenChange={setShowHelpDialog} />
      <motion.div
        className="flex flex-1 overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        {/* Main Canvas Area */}
        <motion.div
          className="flex-1 flex"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          {/* Canvas */}
          <div className="flex-1 flex items-center justify-center p-6 overflow-auto bg-background">
            <motion.div
              className="w-full h-full rounded-lg border-2 border-dashed border-border flex items-center justify-center relative"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.4 }}
            >
              <div className="relative aspect-square w-full max-w-2xl mx-auto rounded-md">
                {/* Image Display Area */}
                <motion.div
                  className="relative aspect-square w-full bg-muted rounded-lg"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.6 }}
                >
                  <LoadingOverlay />
                  <ImageDisplay className="rounded-lg" />
                  {/* Mask Overlay */}
                  <div className="absolute inset-0">
                    <MaskDisplay className="opacity-50 rounded-lg" />
                  </div>
                  {/* Empty State Message */}
                  {!useImageStore.getState().getLatestImage() && (
                    <motion.div
                      className="absolute inset-0 flex items-center justify-center"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3, delay: 0.8 }}
                    >
                      <div className="text-center text-muted-foreground p-4 space-y-2">
                        <p className="text-lg font-medium mb-2">
                          No image generated yet
                        </p>
                        <p className="text-sm">
                          Make sure that broadcast is enabled. You can do this
                          with the{" "}
                          <kbd className="inline-flex items-center gap-1 rounded border bg-muted px-2 font-mono text-xs">
                            <span className="text-xs">⌘</span>B
                          </kbd>{" "}
                          shortcut.
                        </p>
                        <p className="text-sm">
                          Try saying &quot;Generate an image of [your
                          description]&quot;
                        </p>
                        <p className="text-sm">--or--</p>
                        <p className="text-sm">
                          Try saying &quot;Explain how to use Siga&quot;
                        </p>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              </div>
            </motion.div>
          </div>

          {/* Right Panel */}
          <motion.div
            className="w-1/3 border-l border-border bg-card flex flex-col"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          >
            <Header />
            <motion.div
              className="p-4 space-y-4"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.5 }}
            >
              <VoiceSelector value={voice} onValueChange={setVoice} />
              
              
              <div className="flex flex-col gap-2">
                <BroadcastButton
                  isSessionActive={isSessionActive}
                  onClick={handleStartStopClick}
                />
                {isSessionActive && (
                  <motion.div
                    className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <span>Mic: {isMicMuted ? "Muted" : "Active"}</span>
                    <kbd className="inline-flex items-center gap-1 rounded border bg-muted px-2 font-mono text-xs">
                      <span className="text-xs">⌘</span>M
                    </kbd>
                  </motion.div>
                )}
              </div>
            </motion.div>

            <div className="flex flex-1 p-4 justify-between">
              {status && (
                <motion.div
                  className="flex flex-col flex-1 justify-between mb-2 gap-4"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <MessageControls conversation={conversation} />
                  {isSessionActive && (
                    <TextInput
                      onSubmit={sendTextMessage}
                      disabled={!isSessionActive}
                    />
                  )}
                </motion.div>
              )}
            </div>

            {status && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <StatusDisplay status={status} />
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      </motion.div>
    </main>
  );
};

export default App;
