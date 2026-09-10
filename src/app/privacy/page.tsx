import { DocumentPage } from "@/components/DocumentPage";
export default function Page() {
  return (
    <DocumentPage
      eyebrow="YOUR WORKSPACE, EXPLAINED"
      title="Keep your ideas close."
    >
      <p>
        This local installation stores the information you enter to provide your
        simulated workspace. It does not connect to a brokerage account or place
        real trades.
      </p>
      <h2>Guest work</h2>
      <p>
        Guest portfolios, trades, scenarios, and notes are temporary server
        memory associated with a browser cookie. Page refreshes preserve them.
        Ending the browser session, restarting the server, or 24 hours of
        inactivity can end the guest workspace. Save to a profile for durable
        storage.
      </p>
      <h2>Saved profiles</h2>
      <p>
        Your profile, simulated portfolios, transaction history, targets,
        scenario snapshots, research notes, and appearance preferences live in
        this installation’s local database. The account session controls access.
        A local profile is not an encrypted vault against someone with access to
        the database or this computer.
      </p>
      <h2>Provider requests</h2>
      <p>
        Sample mode uses illustrative data. Configured market-data integrations
        send symbol and contract requests to their providers. API credentials
        remain in the local server configuration. Each provider’s terms and
        privacy practices apply to its service. This interface does not purchase
        market data or transmit simulated orders to a broker.
      </p>
      <h2>Drafts in this tab</h2>
      <p>
        Uncommitted scenario and journal drafts use browser session storage so
        they survive navigation and refresh in the same tab. Closing an editor
        clears its draft. Saving a note or scenario commits it to your
        workspace. Session storage is readable by this application and is not an
        encrypted vault.
      </p>
      <h2>Research and exports</h2>
      <p>
        Evidence links open the websites you choose. Exports are files you
        control; anyone you share them with can read their contents. Monetary
        masking is a visual presentation feature, not encryption. CSV and JSON
        exports retain exact values and are labeled accordingly.
      </p>
      <h2>Access and recovery</h2>
      <p>
        This installation uses local email-and-password profiles. Email
        verification, recovery email delivery, passkeys, and remote
        synchronization are not configured. Protect your local account
        credentials and keep a backup of the installation’s database if you need
        durable recovery.
      </p>
      <h2>Fonts and browsing</h2>
      <p>
        Interface fonts are served from this installation. No font service is
        contacted when you load these pages. Your browser may retain downloaded
        reports and normal browsing history.
      </p>
    </DocumentPage>
  );
}
