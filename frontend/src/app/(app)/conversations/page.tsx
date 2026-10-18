export default function ConversationsIndex() {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="max-w-sm">
        <p className="text-lg font-semibold text-ink">Pick a conversation.</p>
        <p className="mt-2 text-sm text-ink-soft">
          Replies go out through the Twilio WhatsApp sandbox. Only phones that have joined the sandbox can receive them, and free-form replies are allowed within 24 hours of the
          customer&apos;s last message.
        </p>
      </div>
    </div>
  );
}
