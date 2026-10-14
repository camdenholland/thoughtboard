# Thoughtboard: Supabase account and cloud storage

Source update for your existing React + TypeScript + Vite project. Adds email/password login, account-restricted notes and image storage, and a retryable import of the prior browser-only board. Keeps the compact layout, Markdown, dates, tags, and private-note confirmation.

## 1. Create the database and private image bucket

Open your Supabase project's **SQL Editor**, create a query, paste the complete contents of `supabase/schema.sql`, and run it. It creates the notes table, account access list, row-level security policies, revision trigger, and private image bucket. You can rerun this script.

Use the fresh project created for this app. If you use an existing project, review any existing Storage policies: PostgreSQL permissive policies combine with OR, so another broad policy could grant more access than these app-specific policies.

## 2. Create your account and grant it access

1. In Supabase, open **Authentication > Users > Add user > Create user**. Enter your email and a password for this app and enable **Auto Confirm User**. This is a new app login, separate from your Supabase dashboard and database passwords.
2. Copy the created user's **User UID**.
3. Open `supabase/add-owner.sql`, replace `REPLACE_WITH_YOUR_AUTH_USER_UUID` with that UUID (keep the quotes), and run the SQL in your project's SQL Editor.
4. In **Authentication > Sign In / Providers**, turn off **Allow new users to sign up**. Keep anonymous sign-ins disabled. Your existing account can still sign in. Email/password sign-in must stay enabled.

Only accounts added to `thoughtboard_members` through an administrative connection can use the board. Creating an auth user alone does not grant access. There is no public signup screen.

## 3. Update your local app

Back up your current source folder first. Copy every file in this ZIP's `src` into your existing project's `src`, replacing matching files. Keep your existing `main.tsx` and its `import "./index.css"`. This package does not replace your Vite scaffolding or package.json.

In your project folder run:

```sh
npm install @supabase/supabase-js react-markdown remark-gfm idb-keyval
```

Keep your `.env.local` in the project root (next to package.json):

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Use the project URL and **publishable** key from Supabase. Never put a secret key, service-role key, or database password in a `VITE_` variable: those variables are included in the browser bundle. The publishable key is meant for the browser; database and storage policies enforce access. Keep `.env.local` out of Git.

Restart Vite after changing environment variables:

```sh
npm run dev
```

## 4. Sign in and import existing notes

Open the app using the **same browser profile and exact origin** as before (including hostname and port). Sign in with the account you created above, then click **Import local notes**. If you previously used `http://localhost:5173`, opening `http://127.0.0.1:5173` or a different port will not find that browser's old notes.

- Import includes private notes and uploaded images. Private notes still start hidden.
- Existing cloud note IDs are skipped; import never overwrites an edited cloud note.
- Failed notes are reported and may be retried. Already-imported notes are skipped without duplicates.
- If a local image is missing, the note referencing it is left unimported so you can resolve it before retrying.
- Original localStorage notes and IndexedDB images are left untouched. Keep them until you have verified the cloud copy.
- There is no automatic background import. Local backups do not receive edits made after this update.

## 5. Verify your project before deployment

1. Add a test note with a tag, date, Markdown, and uploaded image. Reload: it should remain.
2. Edit it and reload, then delete the test note and reload again.
3. Mark a note private. Reload: its content and unique tags should stay hidden until you confirm **Show private notes**.
4. Open the same app in a fresh browser profile or private window. It should show the login screen. Sign in and verify notes and uploaded images appear without local browser backups.
5. Sign out: the board should disappear. Sign in again: private notes should start hidden.

The source was checked with a TypeScript build, real-browser flows against a mocked Supabase API, and SQL policy tests against local PostgreSQL via PGlite. Your actual Supabase project's authentication and Storage service must still pass these checks.

## Board and editor

- Click **+** beside the search bar to add a thought. Use the pencil at the top right of a card to edit it. Titles are optional.
- **Write** and **Preview** switch between Markdown and rendering. Save commits edits; Ctrl+Enter / Cmd+Enter also saves. Cancel or Escape closes the editor, asking before discarding unsaved changes. Canceling a new thought creates no empty card.
- The editor has bold, italic, link, image URL, and upload buttons. Uploads accept PNG, JPEG, WebP, or GIF up to 5 MB. Select text before using bold/italic to format that selection.
- Delete lives inside the editor and requires confirmation.
- Cards use CSS columns and flow down each column. Column count adjusts to available width, with a single column on small phones. Editing, search, and filtering can change card placement. This version does not include manual dragging or pinning.

## Dates

- **Note date (optional)** attaches a calendar day to a thought. Use it for a due date, event, or a date you want to remember. It appears at the bottom of the card. Remove date clears it.
- New notes also record `createdAt`, shown as a small timestamp at the top. Existing notes did not record creation timestamps, so they show **Earlier note**. Their text, tags, images, and privacy settings are preserved.
- Dates are calendar days stored as `YYYY-MM-DD`, rendered in the local timezone without UTC day shifts. They are labels and filters, not scheduled notifications.

## Search and filters

- Search updates as you type. Ctrl+K / Cmd+K focuses the search field.
- Searches titles, Markdown source text (including link URLs and image descriptions), tags, creation dates, and assigned note dates. It does not perform OCR on images.
- Search is case-insensitive. Multiple words must all occur somewhere in the note's searchable fields. Try `practice`, `project ideas`, `Oct 14`, `October 14`, or `2026-10-14`. Natural-language expressions such as `tomorrow` are not interpreted as dates.
- The calendar input beside the tags filters by the assigned **note date** exactly. Search, date, and tag filters combine.
- Several selected tags match **any** selected tag. Click a card's tag to toggle its filter. Tags are comma-separated, lowercased, and deduplicated. A leading `#` is optional.
- **All thoughts** clears tag selection only. **Clear filters** resets search, tags, and date together.
- New thoughts inherit active tags and the selected date. If a saved note is outside the active filters, a status message explains why it is not shown.

## Private notes

- Check **Private note**, or add `private` among its tags. The reserved tag becomes a separate privacy flag when saved. Uncheck the checkbox to make a note visible by default again.
- Private notes start hidden on each page load. **Show private notes** asks “Are you sure you want to display private notes?” Cancel leaves them hidden; **Hide private notes** hides them immediately.
- Search, counts, date filters, and tag filters never include hidden private notes. Tags belonging only to hidden private notes are also omitted. Clearing filters does not reveal private notes.
- This checkbox provides screen privacy within your signed-in board. All notes require your account, including notes without this flag. It is not an additional password or end-to-end encryption.

## Cloud behavior and limitations

- Notes are stored in `public.thoughtboard_notes`; uploaded images are stored in the private `thoughtboard-images` bucket under your user UUID. The browser downloads them using the signed-in session. External image URLs retain the privacy/access properties of their original host.
- The app loads notes after sign-in and on **Refresh**. Use Refresh to see changes made on another device; realtime updates are not included yet.
- Each note has a server-controlled revision. If a note changed elsewhere, save/delete is rejected and the editor keeps the draft. Copy unsaved text, close the editor, refresh, and reapply your changes.
- Saving requires a connection. A failed save keeps the editor open. Unsaved drafts are not stored across reloads; the browser warns before leaving a changed editor.
- Your login persists in this browser until sign-out/session expiry. Sign out on shared devices.
- Removing an image reference, canceling an upload-containing draft, or deleting a note does not delete its uploaded image. Uploads are immutable and retained to avoid breaking shared references; automatic cleanup is future work.
- No SMS integration, offline editing queue, automated backup/export, password recovery UI, dragging, or pinning is included. For this personal prototype, manage your account through Supabase's dashboard. Add a recovery flow before expanding usage.
- Next milestone after this works: deploy to Vercel with the same environment variables, then add an authenticated SMS webhook that saves into these tables.

## Source map

| File                              | Purpose                                                 |
| --------------------------------- | ------------------------------------------------------- |
| `App.tsx` / `Login.tsx`           | Session, account gate, email/password login             |
| `Board.tsx`                       | Notes, controls, local import, privacy confirmation     |
| `supabase.ts`                     | Supabase client and configuration                       |
| `cloudNotes.ts`                   | Cloud CRUD, revision conflicts, paginated reads, import |
| `images.ts`                       | Private uploads/downloads and legacy image migration    |
| `notes.ts`                        | Legacy parsing, dates, filtering                        |
| `NoteEditor.tsx` / `NoteCard.tsx` | Editing and cards                                       |
| `MarkdownContent.tsx`             | Safe Markdown rendering and images                      |
| `App.css` / `index.css`           | Responsive layout and styling                           |
| `supabase/schema.sql`             | Database, access policies, private image bucket         |
| `supabase/add-owner.sql`          | Grant your account access                               |

No demo content is inserted. Raw HTML is skipped. Links use react-markdown's safe URL handling; images accept HTTP(S) URLs and app-owned attachment references.
