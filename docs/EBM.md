# RRA / EBM company information

Wayline collects each bus company's own RRA / EBM details during its application. The company must confirm it is authorized to provide them and upload its registration certificate. EBM credentials are stored in Supabase Vault; they are not sent back to the browser. Schedules and ticket bookings remain blocked until an administrator approves the company's licence and EBM information.

The current integration does not issue tax receipts and does not connect to RRA. Do not enter production credentials until the following are confirmed directly with RRA:

- Whether an online booking platform may issue EBM receipts on behalf of separate bus companies.
- The required authorization model and which credentials, keys, device IDs, or VSDC identifiers each company must provide.
- The official field list, formats, signing method, and secure credential-rotation process.
- The receipt fields, tax categories, VAT treatment, and rounding rules for bus tickets.
- Sandbox availability, test credentials, onboarding process, and production certification requirements.
- Any required network, device-registration, audit, retention, or reporting obligations.

Enable Supabase Vault before applying migration `20261127000000_company_ebm_application.sql`. Admin review is manual; verify the TIN, EBM/VSDC details, business name, and certificate against the company's RRA records. Never use Wayline's TIN as the company's taxpayer information.
