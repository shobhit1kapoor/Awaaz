interface ResponseBubbleProps {
  text: string;
}

export function ResponseBubble({ text }: ResponseBubbleProps) {
  if (!text) {
    return null;
  }

  return <div className="response-bubble">{text}</div>;
}
