-- Providers that work from Pakistan: Telegram (blocked) -> Slack, Stripe (no Pakistani onboarding) -> Lemon Squeezy.
-- Renames keep existing rows valid on databases that already applied the initial migration.

ALTER TYPE "Provider" RENAME VALUE 'TELEGRAM' TO 'SLACK';
ALTER TYPE "Provider" RENAME VALUE 'STRIPE' TO 'LEMONSQUEEZY';

ALTER TABLE "User" RENAME COLUMN "telegramChatId" TO "slackUserId";

ALTER TABLE "Payment" RENAME COLUMN "stripeSessionId" TO "checkoutId";
ALTER TABLE "Payment" RENAME COLUMN "stripePaymentIntentId" TO "providerOrderId";
ALTER INDEX "Payment_stripeSessionId_key" RENAME TO "Payment_checkoutId_key";

ALTER TABLE "AlertDelivery" ALTER COLUMN "channel" SET DEFAULT 'SLACK';
UPDATE "AlertDelivery" SET "channel" = 'SLACK' WHERE "channel" = 'TELEGRAM';

-- Telegram link codes are no longer used (Slack routes by email or member ID)
DROP TABLE IF EXISTS "MemberLink";
