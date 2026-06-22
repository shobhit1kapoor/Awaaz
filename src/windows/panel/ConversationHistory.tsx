import { useAppStore } from '../../store/appStore';

export function ConversationHistory() {
  const conversationHistory = useAppStore((appState) => appState.conversationHistory);

  if (conversationHistory.length === 0) {
    return <p className="empty-history">No conversation yet.</p>;
  }

  return (
    <section className="conversation-history">
      {conversationHistory.map((conversationMessage, conversationMessageIndex) => (
        <article key={`${conversationMessage.role}-${conversationMessageIndex}`}>
          <strong>{conversationMessage.role}</strong>
          <p>{conversationMessage.text}</p>
        </article>
      ))}
    </section>
  );
}
