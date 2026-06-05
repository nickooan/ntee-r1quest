import React, { useEffect, useState } from "react"
import { Box, Text, useApp, useInput } from "ink"
import type { HomeConfigInput } from "../../runtime/config.ts"

export type ConfigGeneratorProps = {
  configPath: string
  onComplete: (config: HomeConfigInput) => void
}

const aiOptions = [
  { label: "None", value: undefined },
  { label: "Codex", value: "codex" },
  { label: "Claude", value: "claude" },
] as const

export const buildHomeConfigInput = (
  root: string,
  selectedAiIndex: number,
): HomeConfigInput => {
  const selectedAi = aiOptions[selectedAiIndex]

  return {
    root: root.trim() || null,
    ...(selectedAi?.value ? { ai: selectedAi.value } : {}),
  }
}

export const ConfigGenerator = ({
  configPath,
  onComplete,
}: ConfigGeneratorProps) => {
  const { exit } = useApp()
  const [step, setStep] = useState<"root" | "ai">("root")
  const [root, setRoot] = useState("")
  const [selectedAiIndex, setSelectedAiIndex] = useState(0)
  const [isCursorVisible, setIsCursorVisible] = useState(true)

  useEffect(() => {
    if (step !== "root") {
      return
    }

    const interval = setInterval(() => {
      setIsCursorVisible((isVisible) => !isVisible)
    }, 500)

    return () => {
      clearInterval(interval)
    }
  }, [step])

  useInput((input, key) => {
    if (key.escape) {
      exit()
      return
    }

    if (step === "root") {
      if (key.return) {
        setStep("ai")
      } else if (key.backspace || key.delete) {
        setRoot((currentRoot) => currentRoot.slice(0, -1))
      } else if (!key.ctrl && !key.meta && input) {
        setRoot((currentRoot) => `${currentRoot}${input}`)
      }

      return
    }

    if (key.upArrow || key.leftArrow) {
      setSelectedAiIndex(
        (currentIndex) =>
          (currentIndex - 1 + aiOptions.length) % aiOptions.length,
      )
      return
    }

    if (key.downArrow || key.rightArrow) {
      setSelectedAiIndex(
        (currentIndex) => (currentIndex + 1) % aiOptions.length,
      )
      return
    }

    if (key.return) {
      onComplete(buildHomeConfigInput(root, selectedAiIndex))
      exit()
    }
  })

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold color="cyan">
        R1Quest Config Generator
      </Text>
      <Text dimColor>{configPath}</Text>
      <Text> </Text>

      <Text dimColor>
        instruction:{" "}
        {step === "root" ? "Type a collection path," : "Select an AI agent,"}
      </Text>
      <Text dimColor>
        {step === "root"
          ? "Press Enter to leave it unset;"
          : "Press Enter to create the config;"}
      </Text>
      <Text dimColor>Press Esc to cancel;</Text>
      <Text> </Text>

      <Box>
        <Text color={step === "root" ? "yellow" : undefined}>
          Collection path [default: null]:{" "}
        </Text>
        <Text color="green">
          {root}
          {step === "root" ? (isCursorVisible ? "|" : " ") : ""}
        </Text>
      </Box>

      <Text> </Text>
      <Text color={step === "ai" ? "yellow" : undefined}>2. AI agent</Text>
      <Box>
        {aiOptions.map((option, index) => (
          <Text
            key={option.label}
            color={
              step === "ai" && index === selectedAiIndex ? "green" : undefined
            }
          >
            {index === selectedAiIndex ? "> " : "  "}
            {option.label}
            {index < aiOptions.length - 1 ? "   " : ""}
          </Text>
        ))}
      </Box>
    </Box>
  )
}
