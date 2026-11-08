# Google Sheet mirror (DATA > GOOGLE SHEET)

Every record in MY/CO/L is copied into one Google Sheet, one tab per record type, and edits typed in the sheet come back into the app.

## Set up (once, about 5 minutes)

You need only your own Google account. No Google Cloud project, no paid service.

1. In the app open **DATA > GOOGLE SHEET** (or type `SHEET` at the prompt). Press **SHEETS.NEW** to make an empty Google Sheet. Name it what you like, for example "MY/CO/L farm records".
2. In the sheet: **Extensions > Apps Script**. Delete what is there. In the app press **COPY SCRIPT**, paste it in, press **Save** (the disk icon).
3. Press **Deploy > New deployment**. Click the gear and pick **Web app**. Set **Execute as: Me** and **Who has access: Anyone** (not "Anyone with Google account": that sends the app to a sign-in page and the sync fails). Press **Deploy**.
4. Google asks you to allow it. Press **Authorize access**, pick your account. If it says "Google hasn't verified this app", press **Advanced > Go to project (unsafe)**: it is your own script. It asks only to "see, edit, create and delete this spreadsheet" (the script cannot open anything else in your Drive).
5. Copy the **Web app URL** (it ends in `/exec`). In the app paste it into **SHEET ADDRESS** and press **SAVE**. The title changes to the sheet's name when the link works.
6. Press **SYNC NOW**. The first sync makes a READ ME tab and one tab for every record type.

After that the app syncs by itself every 5 minutes while it is open, and when the signal comes back.

## What the sheet looks like

- **READ ME** first: the editing rules, when the app last synced, and every tab with its record count.
- One tab per record type, grouped and coloured like the app's menu: genetics (green), production, cook (red), contamination (yellow), stock (brown), sales and money (blue), facility (teal), climate (purple), reference (grey).
- Row 1 holds the field names, frozen. Hover a header to see what goes there.
- Columns: `_action` first, then the record's own fields, then look-up columns (`strain_code`, `lot_code`, `item_name`, `species_name`), then `id`, `created_at`, `updated_at` and `_edited_at` in grey.
- Choice fields have a dropdown taken from the database rules. Yes/no fields are tick boxes.
- Dates are `yyyy-mm-dd`. Times are UTC (the farm clock is UTC-6). Money is in colones as stored.
- Photos show their details only. The picture stays in the app.

## If it says the sheet did not let the app in

Open the web app address in a new browser tab. It should say "MY/CO/L sheet link is running". If Google asks you to sign in, or says you need access, the deployment's access is wrong: in Apps Script press **Deploy > Manage deployments**, the pencil, set **Execute as: Me** and **Who has access: Anyone**, then **Deploy**. The address stays the same.

## Editing rules

1. Change any white cell. The app picks it up at the next sync.
2. Add a record by typing in the first empty row. The sheet gives it an id by itself. A new row that still misses a needed field waits (it is listed in the app) until you fill it in.
3. To point at another record, type its code in the look-up column (`strain_code`, `lot_code`, `item_name`). The app finds it.
4. Delete a record by typing `DELETE` in its `_action` cell. **Deleting the row itself does not delete the record**: the app puts the row back at the next full check (at least once an hour, and on SYNC NOW).
5. Grey cells and grey tabs are read only: **Exchange rates**, **Edit history** and **Sensor readings**. A change there is put back. Exchange rates change only in the app, because every money record keeps its own day's rate.
6. A value that does not fit (letters in a number column, a choice not on the list, an empty needed field) is refused and listed under **LISTED BY THE SYNC**, and the app's value goes back into the sheet.

## Undo, history and conflicts

- Each sync's sheet edits are **one UNDO step**, labelled `GOOGLE SHEET EDITS: ...` and signed **GOOGLE SHEET** in HISTORY. UNDO in the app reverses them, and the next sync writes the old values back into the sheet.
- A field changed only in the sheet takes the sheet's value. A field changed only in the app takes the app's value.
- A field changed **in both** keeps the later change (the sheet's edit time against the app's edit history) and is listed.
- A record deleted in the app stays deleted even if the sheet edited it (listed; HISTORY > RESTORE brings it back).

## Keep it private

The web app address and the key in the script together let anyone change farm records. Keep them private, and share the sheet only with people who could use the app. **MAKE A NEW KEY** in the app makes a new key: copy the script again, paste it over the old one, then **Deploy > Manage deployments > Edit > Version: New version > Deploy** (the address stays the same).

## Where it runs

- The script inside the sheet (`sheets/Code.gs`) writes the app's changes into the tabs, stamps the time on any row a person edits, and hands those rows back.
- The app (on the device that holds the records) does the rest: it reads the edited rows, checks them, saves them, and sends its own changes. It remembers what both sides last agreed on, on that device only (no database change needed).
- In local mode sync from one device only: the one that holds the records. When the farm box (docs/SELF-HOST.md) runs, any owner device can sync, since they share one database.
- Only the owner syncs. STAFF never sees the sheet settings.

## For developers

- `src/lib/sheets/columns.gen.ts` is generated from `supabase/migrations` by `node scripts/sheet-columns.mjs` (kinds, needed fields, dropdown lists). The tests fail if it is out of date: re-run the script after a new migration.
- `src/lib/sheets/schema.ts` tab names, groups, column order; `convert.ts` cells; `engine.ts` the sync; `client.ts` the web app calls; `state.ts` device settings and sync memory; `src/store/useSheetSync.ts` the timer; `src/screens/DataSheet.tsx` the screen.
- `src/lib/sheets/sheets.test.ts` runs the real `sheets/Code.gs` against a pretend spreadsheet (`fakeSheet.ts`): mock trials, history and UNDO, conflicts, refusals, lost signal, a 5,000-record farm, and a random stress test of edits on both sides (`npm run test:stress` runs 60 seeds x 300 steps).
- Migration `0018_sheet_via.sql` lets the edit history say `via = 'sheet'` once a database is linked.
