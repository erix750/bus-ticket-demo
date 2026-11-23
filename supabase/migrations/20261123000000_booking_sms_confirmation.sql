-- Tracks the SMS booking confirmation sent by the send-booking-sms Edge Function.
-- The function runs with the service role; passengers and companies never see these columns.
ALTER TABLE public.bookings
    ADD COLUMN IF NOT EXISTS confirmation_sms_sent_at timestamptz,
    ADD COLUMN IF NOT EXISTS confirmation_sms_error text;

COMMENT ON COLUMN public.bookings.confirmation_sms_sent_at IS
    'Set when the confirmation SMS was claimed or sent; null means not sent yet.';
COMMENT ON COLUMN public.bookings.confirmation_sms_error IS
    'Last SMS delivery error, kept for support; null when the last attempt succeeded.';
