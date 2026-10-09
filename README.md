# Extensible Dimension Database

**Model your business in the app, not in code, and make every fact in it governed, auditable, and ready for AI.**

Extensible Dimension Database is a metadata-driven data platform for the records that run your operation: locations, products, vendors, assets, or anything else you need to track. Administrators shape the data model right in the browser. They add dimensions and attributes, set validation, build cascading choice lists, and decide who can see or edit each field. There are no migrations, no deploys, and no developer in the loop. Everyone else gets a clean, searchable grid and record forms that change as the model changes.

The structure is only the start. Built-in workflows turn data changes into work: a new record or a changed field can notify the right people, or start an action sequence with assignees, deadlines, required fields, and overdue alerts. Every edit is recorded with the before value, the after value, who made it, and when. Access is granted down to the single attribute, by user, group, or department.

The data is also built to be used outside the app:

- **AI-ready by design.** Each person can connect Claude, Cursor, or any MCP-capable assistant with their own token, and the assistant sees only what that person is allowed to see. Attribute names and descriptions explain what each fact means, so the model gets context and not just raw values. Assistants can also propose changes, but nothing is saved until a person approves it, and approved changes land in the changelog like any other edit. For a quick start, a one-click Markdown export packages your permitted data for any model you choose.
- **Partner-ready sharing.** You can publish any slice of your data as a JSON or XML endpoint, secured with a bearer secret and limited to the dimensions, attributes, and date window you choose.
- **Domain-agnostic.** The same engine handles a location portfolio (the included sample data), a product catalog, or a vendor registry. Adding a new kind of record is a configuration change, not a code change.

It's open source under MIT and built on Next.js 16, React 19, PostgreSQL, and Prisma.

The name in the header, on the sign-in page, and in the browser title is a site setting. The screenshots below are from a local site named **Dimension Extender**.

## What you can define

- **Record types** are the kinds of records you keep: locations, vendors, products, or anything else. Each type has its own dimensions, attributes, unique identifier, and records, and its own tab on the Dimension page. A database starts with one type, Location.
- **Dimensions** group attributes. A record is one row that can hold values from every dimension the person is allowed to see.
- **Attributes** are the fields on a record. Each attribute has a key, a display name, a description, a type, and optional rules: required, maximum length, a regular expression, a default, a unique identifier, an active-filter checkbox, or an automatic created date.
- **Lists** supply choices. A list can follow another list, so cities can follow states, and new parent-child catalogs can be added the same way.
- **People** are users, departments, and groups. Navigation and record access are granted to a user, a group, or a department. A user grant overrides a group grant, which overrides a department grant.
- **Workflows** are either a notification or an action sequence. They can start when a record is created, when an attribute changes, or when someone starts one by hand.
- **Sharing** endpoints publish selected dimensions and attributes as JSON or XML at a URL protected by a secret.
- **AI knowledge** is available two ways: a read-only MCP server that returns only what its configured user is allowed to view, and a Markdown export of the records you can view, ready to hand to the AI model of your choice.

## Sign in

The first account is created by the database seed as `admin@local`. Set `ADMIN_PASSWORD` before that first seed, or read the one-time password the seed prints. Later password changes stay in the database.

## Navigation

The menu groups the screens into the main work area, Form Config, People Config, and Settings.

<img width="1085" height="682" alt="image" src="https://github.com/user-attachments/assets/e840c086-ae4d-4320-8880-f94e45d922e0" />

## Dashboard

The dashboard lists open actions assigned to you or to a group you belong to, then recent change notifications. Accept, complete, reject, comment, and reassign an action from the card. Opening an action goes to the record and highlights the attributes that step requires.

![Dashboard](docs/screenshots/dashboard.png)

## Dimensions

The dimension list is the working grid. Search, filter each attribute, choose which attributes are visible, and open a record. **New Record** starts a blank record. **Export CSV** downloads the rows that match the current search and filters. **Export MD** downloads every record you can view as Markdown knowledge cards, ignoring the filters, for use with an AI model.

<img width="1220" height="733" alt="image" src="https://github.com/user-attachments/assets/e4a3d40b-cc69-4950-af46-05d9b6623dc8" />

**Archived** lists records that were archived. Archiving a record (from its page) hides it from the grid, exports, the share API, and AI knowledge, blocks edits, and pauses its open workflows. Its values and changelog are kept, and **Restore** brings it back and resumes those workflows.

A record is edited by dimension. List attributes that follow another list, such as city after state, reload when the parent value changes. List nesting can be more than 2 deep. The created-date attribute is filled from the record and is read only. The page also shows the latest edits for that record and can start a workflow that allows a manual start.

![Record](docs/screenshots/record.png)

![New record](docs/screenshots/new-record.png)

## Import

**Import** on the Dimension page creates and updates records from a CSV file. Headers are attribute keys or display names, so a file from Export CSV can be edited and imported back. When the file includes the unique identifier, matching rows update existing records and the rest create new ones. Every row is checked with the same rules as the record form first, and the preview shows how many rows will be created, updated, or skipped, with the reason for each error, before anything is saved. Imported changes are written to the Changelog and sent to webhooks; running workflows for them is optional.

## Action report

The action report reviews actions and the history of what was done on them. Filter by department, group, user, dates, and dimension identifier. Open actions can be postponed or suspended from this report.

![Action report](docs/screenshots/action-report.png)

## Data definition

**Record types** are managed at the top of the page: add a type, rename it, or hide it. Dimensions are grouped by type, and a new dimension is added to the type you choose. Dimension names are unique across types.

Each dimension starts collapsed. Open it to rename it, reorder attributes, hide or delete them, and add a new attribute. Deleting an attribute that already has values asks for confirmation. Confirming with **Yes, Delete** removes the correlated values so nothing is left dangling. The dimension records themselves stay.

![Collapsed dimensions](docs/screenshots/data-definition.png)

![A dimension opened](docs/screenshots/data-definition-open.png)

Attribute types include text, big text, numeric, date, time, date and time, checkbox, radio, list, zip code, address, email, phone, coordinate, and **link to record**. A link points to one or several records of a chosen record type, such as a location's vendors. On a record, people choose the linked records by their unique identifier, and the linked record lists every record that points to it under **Linked from**. Validation is a regular expression. An empty pattern adds no extra check.

## Lists

Create a list, optionally set which list it follows, and manage its items. Child items can be limited to values from the parent list. US States and US Cities use this same mechanism and can be edited here.

![Lists](docs/screenshots/lists.png)

![List contents](docs/screenshots/list-contents.png)

## Permissions

Choose a user or a department and set None, View, or Edit for each menu item. Dimension grants control who can add, hide, or edit attributes, who can see records, and who can view or update each attribute.

![Permissions](docs/screenshots/permissions.png)

## Users

Create an account, mark an administrator, and add the person to groups. Open a user to change the password, set per-user attribute grants, and assign workflow steps.

![Users](docs/screenshots/users.png)

![A user account](docs/screenshots/user.png)

## Access

Departments and groups are created here. A group can grant view or edit for an entire dimension or for specific attributes. Disabling a group hides it from new workflow choices. Group membership is assigned on the user page.

![Access](docs/screenshots/access.png)

## Workflows

A workflow is a notification or an action sequence.

- **Notify** sends the previous value, the new value, who saved it, and when. Recipients are groups and specific users. No action is created.
- **Action sequence** assigns steps to a group, with an optional person and a deadline. A step can require an attribute to have a value, or to have been changed after the action opened.

Triggers are record created, attribute change (with an optional match value), and manual start. Leave Dimensions empty to apply the workflow to every record.

![Workflows](docs/screenshots/workflows.png)

![An action sequence](docs/screenshots/workflow-open.png)

## Changelog

Every saved attribute change is recorded with the old value, the new value, the person, and the time. Filter by text, record, dimension, attribute, person, and date.

![Changelog](docs/screenshots/changelog.png)

## Settings

**Site** sets the name used in the header, on the sign-in page, in the browser title, and at the start of email subjects.

![Site](docs/screenshots/site.png)

**API Config** creates a share endpoint. Choose JSON or XML, an optional date window, and the dimensions or attributes to include. Callers send the secret as `Authorization: Bearer`. Only a hash of the secret is stored, so it is shown once, when the endpoint is created or the secret is regenerated; afterwards the page shows only its last four characters. A caller that sends the wrong secret more than 5 times is blocked from that endpoint for an hour.

![API configuration](docs/screenshots/api.png)

![New share endpoint](docs/screenshots/api-new.png)

**Email Config** stores the SMTP server, port, security (none, STARTTLS, or TLS), username, and password. The password is encrypted in the database and is not shown again after it is saved. Messages are always stored in the app, including when email is off.

![Email configuration](docs/screenshots/email.png)

**Webhooks** send a signed JSON message to another system when records are created, updated, archived, or restored, optionally limited to certain dimensions. Each request carries an `X-Dimension-Signature` header (`t=<unix time>,v1=<HMAC-SHA256 of "t.body">`) so the receiver can verify it. Failed deliveries are retried for about a day, and each webhook shows its recent deliveries with a manual retry and a **Send test** button. For safety, webhooks only reach public `https://` addresses; set `WEBHOOK_ALLOW_PRIVATE=true` to allow local or internal targets.

**Single sign-on** connects any OpenID Connect provider: Microsoft Entra ID, Google Workspace, Okta, Auth0, Keycloak, and others. Enter the issuer, client ID, and client secret, register the redirect URI the page shows, and a **Sign in with SSO** button appears on the sign-in page. People sign in to their existing account by verified email, and the provider's identity is linked on first use. Optionally, accounts are created on first sign-in for allowed email domains and added to a group, and password sign-in can be limited to administrators. Set `APP_URL` to the app's public address in production.

**Audit log** lists every successful administrative change: data definitions, lists, users, groups, permissions, workflows, API endpoints, email and site settings, sign-ins, and sign-out-everywhere. Each entry shows who made it, when, and the submitted values. Passwords and secrets are never recorded. Grant access to it like any other screen on Permissions.

## Security

- **Sessions** are stored on the server. Signing out ends that browser's session. Changing a password or disabling an account signs the person out everywhere, and a user's page lists their signed-in browsers with a **Sign out everywhere** button.
- **Sign-in throttling** slows guessing without locking anyone out: after 5 failures for an email, each attempt waits a little longer, up to 5 minutes. Repeated failures from one address are blocked per address.
- **Attribute permissions apply everywhere.** Change notifications, emails, the dashboard, the changelog, exports, and the MCP server only show values a person is allowed to view.
- **Record saves are all-or-nothing**, and unique identifiers are checked under a database lock so two people cannot save the same identifier at once.
- **Behind a reverse proxy, set `TRUST_PROXY=true`** so the app sees each caller's real address. Without it, every remote caller shares one address, and per-address throttling is turned off rather than blocking everyone.

## AI knowledge

Models use this database as a brand knowledge source. The schema (dimension and attribute names, descriptions, and lists) tells a model what a fact means. Records are retrieved when a question needs them, as short knowledge cards. Edits in the changelog refresh that knowledge. The share API remains a bulk JSON or XML export for partners. The AI contract is an MCP server, described in [docs/ai-knowledge.md](docs/ai-knowledge.md). It provides a `schema` resource and `search_records`, `get_record`, and `recent_changes` tools.

- **Hosted, per person.** On **AI access**, each person creates a token and copies the connection command for their assistant. The app serves MCP at `/api/mcp`, and the assistant answers from what that person can view. Tokens can expire and be revoked, and administrators can revoke anyone's.
- **Governed write-back.** A token created with **Allow proposing changes** adds a `propose_change` tool. The assistant's change is checked with the record form's rules, then waits on **AI proposals** until someone approves or rejects it. Reviewers can only approve attributes they may update, and someone other than the token's owner must review it unless the reviewer is an administrator. Approved changes are saved with the changelog, workflows, and webhooks, and are marked as coming from an AI proposal.
- **Local and read-only.** `npm run mcp` runs the same tools over stdio as the user in `MCP_USER_EMAIL`, with no write tools.

For a one-off handoff without MCP, use **Export MD** on the dimension grid.

## Stack

- Next.js 16 (App Router) and React 19
- TypeScript and Tailwind CSS 4
- PostgreSQL with Prisma 6
- Server-side sessions behind a signed httpOnly cookie
- OpenID Connect single sign-on with openid-client
- Model Context Protocol server (stdio and Streamable HTTP)
- Nodemailer for optional SMTP delivery

## Run with Docker

```bash
cp .env.example .env      # set AUTH_SECRET, and ADMIN_PASSWORD for the first start
docker compose up -d
```

This starts PostgreSQL and the app on [http://localhost:3000](http://localhost:3000). On every start the app applies migrations; on the first start against an empty database it also runs the seed. Set `TRUST_PROXY=true` in `.env` when the app sits behind a reverse proxy.

## Background jobs

The app checks for overdue actions every 15 minutes (`OVERDUE_CHECK_MINUTES`) and cleans up expired sessions and throttling counters every 6 hours. When several app servers share one database, a database lock makes sure only one runs each job. To use an outside scheduler instead, set `SCHEDULER=off` and have it `POST /api/alerts/overdue` with the `x-alert-secret` header set to `ALERT_SECRET`.

## Local setup

1. Install Node.js and PostgreSQL.
2. Create the database and role named in `.env.example`, and allow that role to use the `public` schema.
3. Copy the example environment file and set a long random `AUTH_SECRET` (at least 32 characters):

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

4. Install dependencies, apply the migrations, and seed the administrator, the starting dimension, the US state and city lists, and the sample restaurant records:

```bash
npm install
npx prisma migrate deploy
npm run db:seed
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) and sign in as `admin@local`.

Run the checks with `npm run typecheck`, `npm run lint`, and `npm test`. GitHub Actions runs all of them on every pull request, along with every migration and the seed against an empty PostgreSQL database.

**Upgrading an existing database:** run `npx prisma migrate deploy` after pulling. Existing share secrets keep working (they are converted to hashes in place), and everyone signs in once more because sessions moved to the server.

`.env` is not committed. Set `ADMIN_PASSWORD` in `.env` before the first seed if you want to choose the administrator password. If you leave it unset, the seed prints a one-time password and does not print it again on later runs.

## License

This project is licensed under the [MIT License](LICENSE).
