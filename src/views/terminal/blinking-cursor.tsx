import { useEffect, useState } from "react"
import { Text } from "ink"

const cursorBlinkIntervalMs = 500

type BlinkingCursorProps = {
  active: boolean
  activityId: number
  bold?: boolean
  backgroundColor?: string
}

// Owns its own visibility state so the blink timer re-renders only this leaf,
// not the whole app. `activityId` bumps on each keypress to reset the phase so
// the cursor stays solid while the user is actively typing.
export const BlinkingCursor = ({
  active,
  activityId,
  bold,
  backgroundColor,
}: BlinkingCursorProps) => {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    setIsVisible(true)

    if (!active) {
      return
    }

    const interval = setInterval(() => {
      setIsVisible((currentValue) => !currentValue)
    }, cursorBlinkIntervalMs)

    return () => {
      clearInterval(interval)
    }
  }, [active, activityId])

  return (
    <Text bold={bold} backgroundColor={backgroundColor}>
      {isVisible ? "_" : " "}
    </Text>
  )
}
