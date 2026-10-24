import { COMPANY_ROLES, type CompanyRole, type GuideBook } from "./types";

/**
 * SOP guides, English. Each describes orrn's own screens (spec §3). Button, tab
 * and status names are in straight double quotes and match an en.ts value
 * exactly (parity.test.ts checks this), so a reader can find them on screen.
 * Roles follow ROLE_ACTIONS in packages/server/src/lib/permissions.ts.
 * Lines that touch plant practice are marked `confirm:` and listed in
 * docs/superpowers/review/owner-questions.md.
 */

const FLOOR: CompanyRole[] = ["owner", "admin", "manager", "supervisor", "packer", "operator"];
const OFFICE: CompanyRole[] = ["owner", "admin", "manager", "office"];
const EVERYONE: CompanyRole[] = [...COMPANY_ROLES];

export const guidesEn: GuideBook = {
  "pack-session": {
    slug: "pack-session",
    roles: FLOOR,
    title: "Pack a session and print labels",
    when: "Use this when bundles from one die are packed and you have each bundle's weight and piece count.",
    steps: [
      {
        title: "Start a session",
        body: "Open \"Pack\" and tap \"New packing session\".",
      },
      {
        title: "Choose the die",
        body: "Search by die code or section. Dies you used recently are at the top. Archived dies don't show here.",
      },
      {
        title: "Set cut length and PO",
        body: "Enter the cut length once for the whole session, and the PO if there is one. Every bundle uses these unless you change them on that bundle.",
      },
      {
        title: "Enter each bundle",
        // confirm: weight before pieces (owner question Q2).
        body: "Type the weight in kg and press \"Next\". Type the pieces and press \"Next\" again. The bundle is added to the list and a new card opens.",
      },
      {
        title: "Check the kg/12ft chip",
        body: "Green means the bundle is in the die's range. Amber means it is below or above. Check the weight and pieces before you carry on.",
      },
      {
        title: "Review and save",
        body: "Tap \"Review\" and check the bundle count, pieces and kg. Then tap \"Save and print labels\". If label printing isn't set up, the button says \"Save session\".",
      },
    ],
    problems: [
      {
        title: "One bundle has a different length or PO",
        fix: "On that bundle's card, tap \"Different length or PO\" and enter it. The rest of the session keeps the defaults.",
      },
      {
        title: "I typed a wrong weight",
        fix: "Before saving, tap the bundle's row to edit or remove it. After saving, void that bundle and pack it again.",
      },
      {
        title: "Some labels didn't print",
        fix: "The session is already saved. Tap \"Retry failed labels\", or open the session later and tap \"Reprint\" on each bundle. If it keeps failing, see \"The printer isn't printing\".",
      },
    ],
  },

  "reprint-label": {
    slug: "reprint-label",
    roles: FLOOR,
    title: "Reprint a label",
    when: "Use this when a bundle's label is torn, wet, unreadable or missing.",
    steps: [
      {
        title: "Find the bundle",
        body: "Scan the old label if it still reads. If it doesn't, open \"Stock\", then \"Bundles\", and search the serial or PO.",
      },
      {
        title: "Check it's the right bundle",
        body: "Compare the serial, weight and pieces on screen with the bundle in front of you.",
      },
      {
        title: "Reprint",
        body: "Tap \"Reprint label\". From a packing session you can also tap \"Reprint\" on one bundle, or \"Print all labels\" for the whole session.",
      },
      {
        title: "Replace the label",
        // confirm: plant practice for removing the old label (owner question Q5).
        body: "Take the new label from the printer and put it on the bundle. Remove the old label so the bundle carries only one.",
      },
    ],
    problems: [
      {
        title: "There's no \"Reprint\" button",
        fix: "Either your role can't print or label printing isn't set up for your company. Ask a manager.",
      },
      {
        title: "I can't find the bundle",
        fix: "Check the serial letter by letter. Serials look like BG-000001-B001. You can also search by PO.",
      },
      {
        title: "The label came out blank or cut off",
        fix: "See \"The printer isn't printing\".",
      },
    ],
  },

  "scan-bundle": {
    slug: "scan-bundle",
    roles: EVERYONE,
    title: "Scan and check a bundle",
    when: "Use this to see a bundle's details, status and dispatch from its label.",
    steps: [
      {
        title: "Open Scan",
        body: "On a phone, tap \"Scan\" in the middle of the bottom bar. On a laptop, click \"Scan or search\", or press Ctrl+K (Cmd+K on a Mac).",
      },
      {
        title: "Allow the camera",
        body: "The first time, orrn asks to use the camera. Allow it. orrn only uses it to read labels.",
      },
      {
        title: "Point at the label",
        body: "Hold the QR code or barcode inside the frame. In a dark spot, turn on the torch.",
      },
      {
        title: "Read the result",
        body: "The bundle opens. Green means \"In stock\", blue means \"Held\", red means \"Void\". A dispatched bundle shows which dispatch it went in.",
      },
      {
        title: "No camera, or a barcode gun",
        body: "Type the serial in the box and press Enter. A barcode scanner on a laptop types into the same box.",
      },
    ],
    problems: [
      {
        title: "It says \"Not found in this company\"",
        fix: "Check the serial you typed. If it's right, the label isn't from a bundle in your company.",
      },
      {
        title: "The camera is blocked",
        fix: "Allow camera access in your browser or phone settings, then open \"Scan\" again. You can always type the serial instead.",
      },
      {
        title: "The camera won't read the label",
        fix: "Wipe the label, move a little closer and turn on the torch. If the label is damaged, type the serial and reprint the label.",
      },
    ],
  },

  "build-dispatch": {
    slug: "build-dispatch",
    roles: FLOOR,
    title: "Build a dispatch by scanning",
    when: "Use this to add bundles to a dispatch that is being built.",
    steps: [
      {
        title: "Open the dispatch",
        // confirm: who starts a dispatch (owner question Q4).
        body: "Open \"Dispatch\", go to the \"Building\" tab and tap the dispatch. If it isn't there, ask the office to create it with \"New dispatch\".",
      },
      {
        title: "Start scanning",
        body: "Tap \"Scan bundles\". The camera stays open and adds each bundle you scan.",
      },
      {
        title: "Scan each label",
        body: "Scan one label at a time. Each bundle that goes in shows up in the list and the count goes up.",
      },
      {
        title: "Read any warning",
        body: "If a bundle is held for another dispatch, void or already dispatched, orrn says why and doesn't add it. Check with your manager before using that bundle.",
      },
      {
        title: "Have a list of serials instead?",
        body: "Tap \"Paste serials\", paste them in and tap \"Add bundles\". orrn shows how many were added and why any were skipped.",
      },
      {
        title: "Check the totals",
        body: "Tap \"Done scanning\". Bundles are grouped by section with a bundle count and kg for each group. Check them against the order.",
      },
    ],
    problems: [
      {
        title: "It says \"Already in this dispatch\"",
        fix: "You scanned the same bundle twice. Nothing changed. Carry on with the next one.",
      },
      {
        title: "A wrong bundle went in",
        fix: "Tap the remove button on that bundle's row.",
      },
      {
        title: "There's no \"Scan bundles\" button",
        fix: "The dispatch isn't in \"Building\" any more, or your role can't add bundles. Check the status at the top of the dispatch.",
      },
    ],
  },

  "hold-and-dispatch": {
    slug: "hold-and-dispatch",
    roles: OFFICE,
    title: "Hold stock, dispatch, and print the packing list",
    when: "Use this when a dispatch has all its bundles and is ready to go.",
    steps: [
      {
        title: "Check the dispatch",
        body: "Open the dispatch and check the customer, bundle count and kg at the top.",
      },
      {
        title: "Hold stock",
        body: "Tap \"Hold stock\". Every bundle in the dispatch is held for it, so nobody can put them in another dispatch. Bundles added after this are held straight away.",
      },
      {
        title: "Release if plans change",
        body: "Tap \"Release\" to send the dispatch back to \"Building\". Its bundles go back in stock until you hold again.",
      },
      {
        title: "Dispatch",
        // confirm: the moment the floor marks a dispatch done (owner question Q6).
        body: "When the bundles are ready to leave, tap \"Dispatch\", check the totals and confirm. After this, bundles can't be added or removed.",
      },
      {
        title: "Get the packing list",
        body: "The packing list opens. Tap \"Download PDF\" to print it, or \"Download Excel\" for the office. On the phone app, tap \"Share\" to send it.",
      },
    ],
    problems: [
      {
        title: "I don't see \"Hold stock\" or \"Dispatch\"",
        fix: "Only managers, admins and owners can hold and dispatch. Ask one of them.",
      },
      {
        title: "The dispatch has to be stopped",
        fix: "Open \"More actions\" and tap \"Cancel dispatch\". Held bundles go back to stock. A dispatch that is already \"Dispatched\" can't be cancelled.",
      },
      {
        title: "A number on the packing list looks wrong",
        fix: "A manager can tap \"Regenerate\" to build the packing list again from the bundles as they are now.",
      },
    ],
  },

  "void-bundle": {
    slug: "void-bundle",
    roles: FLOOR,
    title: "Void or restore a bundle",
    when: "Use this when a bundle should not be sold as entered, for example it was packed twice or has the wrong weight.",
    steps: [
      {
        title: "Open the bundle",
        body: "Scan its label, or open \"Stock\", then \"Bundles\", and search the serial.",
      },
      {
        title: "Check the status",
        body: "Only a bundle that is \"In stock\" can be voided. If it is \"Held\", it has to come out of its dispatch first. Ask a manager.",
      },
      {
        title: "Void it",
        body: "Tap \"Void bundle\", write the reason and confirm. The bundle turns red and can't go into a dispatch.",
      },
      {
        title: "Restore it if needed",
        body: "If the void was a mistake, open the bundle, tap \"Restore bundle\" and give a reason. It goes back to \"In stock\".",
      },
      {
        title: "Check the history",
        body: "The \"History\" list on the bundle shows each change, who made it and the reason.",
      },
    ],
    problems: [
      {
        title: "There's no \"Void bundle\" button",
        fix: "Either the bundle isn't \"In stock\", or your role can't change bundle status. Ask a manager.",
      },
      {
        title: "I voided the wrong bundle",
        fix: "Restore it straight away with a reason. The history keeps both changes.",
      },
    ],
  },

  "edit-die": {
    slug: "edit-die",
    roles: OFFICE,
    title: "Add or edit a die",
    when: "Use this when a new die arrives or a die's details change.",
    steps: [
      {
        title: "Open Dies",
        body: "Open \"More\", then \"Dies\". Tap \"New die\". To change a die, open it and tap \"Edit die\".",
      },
      {
        title: "Enter the code",
        body: "Fill in the series, section code and name. The floor sees the section code when picking a die in Pack.",
      },
      {
        title: "Set the weight range",
        // confirm: range basis (owner question Q1).
        body: "Enter the min and max weight in kg for one 12 ft length. Pack uses this range for the green or amber kg/12ft chip.",
      },
      {
        title: "Set the status",
        body: "\"Active\" dies show in Pack. \"Archived\" dies are hidden from Pack but keep all their bundles and history.",
      },
      {
        title: "Add measurements if you have them",
        body: "Width, thickness, oblique and leg are under \"Advanced\". They are optional.",
      },
      {
        title: "Save",
        body: "Tap \"Save die\". The die's page opens with its weight band and measurements.",
      },
    ],
    problems: [
      {
        title: "It says the code belongs to a deleted die",
        fix: "That code was used by a die that was deleted. Use a different code.",
      },
      {
        title: "I have many dies to add",
        fix: "Use \"Import CSV\" from the menu on the Dies list. Owners and admins can also import from \"Settings\", then \"Data\".",
      },
      {
        title: "I can't edit dies",
        fix: "Only managers, admins and owners can add or change dies.",
      },
    ],
  },

  "add-customer": {
    slug: "add-customer",
    roles: OFFICE,
    title: "Add a customer",
    when: "Use this before the first dispatch to a new customer.",
    steps: [
      {
        title: "Open Customers",
        body: "Open \"More\", then \"Customers\", and tap \"New customer\". You can also tap \"New customer\" while creating a dispatch.",
      },
      {
        title: "Name and contact",
        body: "Enter the name as it should print on the packing list, then the phone and email.",
      },
      {
        title: "GSTIN",
        body: "Enter the 15-character GSTIN if the customer has one.",
      },
      {
        title: "Addresses",
        body: "Enter the billing address. If goods go to the same place, tick \"Same as billing address\". If not, fill in the shipping address.",
      },
      {
        title: "Save",
        body: "Tap \"Save customer\". The customer's page opens; it lists every dispatch to them, and \"Edit customer\" changes the details later.",
      },
    ],
    problems: [
      {
        title: "The customer may already exist",
        fix: "Search the list by name, phone or GSTIN before adding, so the same customer isn't added twice.",
      },
      {
        title: "I can't add customers",
        fix: "Only managers, admins and owners can add or change customers.",
      },
    ],
  },

  "invite-member": {
    slug: "invite-member",
    roles: ["owner", "admin"],
    title: "Invite a team member and choose a role",
    when: "Use this when someone new needs to use orrn for your company.",
    steps: [
      {
        title: "Open Team",
        body: "Open \"Settings\" and go to the \"Team\" tab.",
      },
      {
        title: "Enter their email",
        body: "Tap \"Invite member\" and type the email they will sign in with.",
      },
      {
        title: "Choose a role",
        body: "\"Operator\" for floor staff who pack, scan and print labels. \"Manager\" for staff who also run dispatches, dies, customers and printers. \"Viewer\" for people who only need to look. \"Admin\" for people who also manage the team and settings.",
      },
      {
        title: "Send the invite",
        body: "Tap \"Send invite\". They get an email with a link that works for 7 days.",
      },
      {
        title: "They join",
        body: "They open the link, enter their name and a password, and they are in.",
      },
      {
        title: "Change or remove later",
        body: "From the Team list you can change a member's role or remove them. Only an owner can change another owner.",
      },
    ],
    problems: [
      {
        title: "The email didn't arrive",
        fix: "Ask them to check spam. If it isn't there, check the email address, cancel the invite and send a new one.",
      },
      {
        title: "The link has expired",
        fix: "Links work for 7 days. Cancel the old invite and send a new one.",
      },
      {
        title: "I gave the wrong role",
        fix: "Change it from the Team list.",
      },
    ],
  },

  "printer-trouble": {
    slug: "printer-trouble",
    roles: EVERYONE,
    title: "The printer isn't printing",
    when: "Use this when labels don't come out, come out blank, or the queue shows failed jobs.",
    steps: [
      {
        title: "Check the queue",
        body: "Open \"Printing\" and look at the \"Queue\" tab. A failed job shows \"Failed\" and the reason.",
      },
      {
        title: "Check the printer",
        body: "Open the \"Printers\" tab. If the printer shows \"Offline\", check it is switched on, has labels loaded and its cable is connected.",
      },
      {
        title: "Check label printing",
        // confirm: who looks after the plant print computer (owner question Q7).
        body: "If every printer is \"Offline\", open \"Settings\", then \"Printing\". If it says \"Not connected\", the plant computer that sends labels to the printers is off or has no internet. Ask whoever looks after it to restart it.",
      },
      {
        title: "Retry the job",
        body: "Once the printer is back, a manager taps \"Retry\" on the failed job in the \"Queue\" tab. You can also reprint from the bundle or the packing session.",
      },
      {
        title: "Still stuck",
        body: "Note the reason shown on the failed job and send it to the orrn team.",
      },
    ],
    problems: [
      {
        title: "Labels come out blank",
        fix: "Check the label roll is loaded the right way round. If it still happens, ask a manager to tap \"Send label design to printers\" on the \"Labels\" tab.",
      },
      {
        title: "It says \"Label printing isn't set up\"",
        fix: "Label printing hasn't been set up for your company yet. Ask the orrn team.",
      },
      {
        title: "There's no \"Retry\" button",
        fix: "Only managers, admins and owners can retry or cancel jobs. Ask one of them.",
      },
    ],
  },
  "weigh-scrap-lot": {
    slug: "weigh-scrap-lot",
    roles: ["owner", "office", "storekeeper", "operator"],
    title: "Weigh a scrap lot",
    when: "Use this when a scrap truck comes to the kanta.",
    steps: [
      {
        title: "Start the lot",
        body: "Open \"Purchase\" and tap \"New lot\".",
      },
      {
        title: "Pick the vendor",
        body: "Search by the name on the slip. Any spelling the book uses finds the same vendor. For a new party, tap \"Add new vendor\". A manager confirms it later.",
      },
      {
        title: "Material and rate",
        body: "Choose the material and the grade, and type the rate per kg. The vendor's usual material and last rate are one tap away.",
      },
      {
        title: "Enter both weights",
        body: "Type the weight on the party's slip, then our kanta weight. The difference and the tolerance show straight away. If the truck is not weighed here yet, leave our kanta empty and add it later with \"Edit weights\".",
      },
      {
        title: "Short beyond the tolerance",
        // confirm: the debit note covers the whole difference by default (owner question in the PLW2 ledger).
        body: "If the lot is short beyond the tolerance, the office raises the debit note on the same screen: keep \"Raise the debit note now\" on and check the kg. A manager approves it in \"Approvals\".",
      },
      {
        title: "Save and mark OK",
        body: "Tap \"Save lot\". When the truck is unloaded, open the lot and tap \"Mark OK\". The scrap goes into scrap stock.",
      },
    ],
    problems: [
      {
        title: "There is no \"Mark OK\" button",
        fix: "Either our kanta weight is missing, or the lot is short beyond the tolerance and no debit note covers it. The lot page says which.",
      },
      {
        title: "I typed a wrong weight",
        fix: "Open the lot and tap \"Edit weights\" before it is OK. Once a note on the weight is open the weights are locked, so ask the manager to reject that note first.",
      },
      {
        title: "The same vendor shows up twice",
        fix: "A manager merges the two vendors in Masters. Their lots move with the merge.",
      },
    ],
  },
  "store-entries": {
    slug: "store-entries",
    roles: ["owner", "storekeeper"],
    title: "Issue and receive store items",
    when: "Use this when chemicals, fuel, gas or spares leave the store or a delivery comes in.",
    steps: [
      {
        title: "Open the store",
        body: "Open \"Store\". Every item shows how much is in the store now.",
      },
      {
        title: "Issue to the floor",
        body: "Tap \"Issue\", pick the item, type the quantity and choose what it is for. Tap \"Issue\" again to save. The MRS number shows on screen.",
      },
      {
        title: "Receive a delivery",
        body: "Tap \"Receive\", pick the item, type the quantity from the challan and add the challan or bill number. Tap \"Receive\" again to save. The GRN number shows on screen.",
      },
      {
        title: "Exchange old for new",
        body: "When an old part leaves the store and a new one comes in, tap \"Exchange\". Type how many go out and how many come in.",
      },
      {
        title: "Check an item",
        body: "Tap an item in the list to see its balance and every entry for it.",
      },
    ],
    problems: [
      {
        title: "It says there is not enough in the store",
        fix: "You typed more than the store holds. Issue less, or receive the delivery first and then issue.",
      },
      {
        title: "I saved a wrong quantity",
        fix: "Open the entry, tap \"Cancel entry\" and write why. Then make the entry again with the right quantity.",
      },
      {
        title: "The item is not in the list",
        fix: "Open \"Store items\" and tap \"Add item\". Choose its unit carefully: it can't change after the first entry.",
      },
    ],
  },

  "stock-by-die": {
    slug: "stock-by-die",
    roles: EVERYONE,
    title: "Check stock by die",
    when: "Use this to see how many bundles and how many kg of one die are in stock or held.",
    steps: [
      {
        title: "Open Stock",
        body: "Open \"Stock\". The \"Sections\" view lists one block for each die section that has bundles on the floor.",
      },
      {
        title: "Find the die",
        body: "Type the die or section code in \"Search die or section\". The list narrows as you type.",
      },
      {
        title: "Read the block",
        body: "Each block shows the bundles in stock, the bundles held for a dispatch, the kg and the kg/12ft weight range. Held bundles are counted apart from the ones in stock.",
      },
      {
        title: "Open the section",
        body: "Tap the block to see its bundles. Use \"Status\" to show \"In stock\", \"Held\" or \"Dispatched\" bundles.",
      },
      {
        title: "Open one bundle",
        body: "Tap a bundle to see its weight, pieces, cut length and history. For the die's own details, tap \"Die details\".",
      },
    ],
    problems: [
      {
        title: "The die isn't in the list",
        fix: "Only sections with bundles on the floor show here. If the die was packed recently, tap \"Clear search\" and check the spelling of the code. Dispatched or void bundles are not counted as stock.",
      },
      {
        title: "The count doesn't match the yard",
        fix: "The screen shows what orrn has recorded, so unrecorded packing and dispatch change it. Do a count before you adjust anything. See \"Count the stock\".",
      },
    ],
  },

  "stock-count": {
    slug: "stock-count",
    roles: ["owner", "admin", "manager", "supervisor"],
    title: "Count the stock",
    when: "Use this for the quarterly physical count, when every bundle in the yard is checked against what orrn holds.",
    steps: [
      {
        title: "Stop packing and dispatch",
        // confirm: who stops the lines and for how long (owner question).
        body: "Tell the packers and the dispatch team to stop before the count starts. A bundle packed or sent out during the count will show as a mistake.",
      },
      {
        title: "Take a fresh stock list",
        body: "Ask the office to load today's stock list into the Stock Count tool on the office computer. orrn has no count screen yet, so the count runs in that tool and it never changes your stock.",
      },
      {
        title: "Scan every bundle",
        body: "Walk the yard location by location. Scan each bundle's QR label. You can also type the printed bundle number. The tool tells you the result with a colour and a beep.",
      },
      {
        title: "Read the colours",
        body: "Green means counted. Amber means you already scanned it. Red means the bundle is not in the stock list. Leave red and amber bundles where they are and note them.",
      },
      {
        title: "Chase what's missing",
        body: "When the yard is done, open the list of bundles not found yet. Look again in the nearby locations before you give up on a bundle.",
      },
      {
        title: "Save the result",
        body: "Export the result as a CSV file and give it to the manager. Fix the differences in orrn only after the manager has agreed them. Then restart packing and dispatch.",
      },
    ],
    problems: [
      {
        title: "A bundle has no QR label",
        fix: "Type the bundle number printed on it. If the number is unreadable too, put the bundle aside and give it to the manager.",
      },
      {
        title: "Many bundles are not found",
        fix: "Do not adjust anything yet. Check that the count did not start before the last dispatch was recorded. Most gaps come from the tail of a production run that was never marked as sent.",
      },
      {
        title: "The count was interrupted",
        fix: "The tool keeps your scans on that computer for the same stock list. Open it again on the same browser and carry on.",
      },
    ],
  },

  "approve-access-request": {
    slug: "approve-access-request",
    roles: ["platform_admin"],
    title: "Approve an access request",
    when: "Use this when a plant has asked for access on the website and orrn support has to set up its company.",
    steps: [
      {
        title: "Open the requests",
        body: "Sign in to Godseye and open \"Access requests\". Requests that are waiting are at the top.",
      },
      {
        title: "Read the request",
        body: "Check the company name, the contact's name and work email, the number of extrusion lines and the notes. If anything looks wrong, call the contact before you approve.",
      },
      {
        title: "Approve or reject",
        body: "Tap \"Approve\" to set up the company and its first owner. Tap \"Reject\" if the request is a duplicate or not a real plant. orrn shows \"Request approved\" when it is done.",
      },
      {
        title: "Send the sign-in details",
        body: "orrn emails the new owner. If the email doesn't arrive, copy the sign-in details shown after approval and send them yourself.",
      },
      {
        title: "Check the new company",
        body: "Open the company under \"Companies\". Check the plan and modules, and that label printing is set up if the plant needs it.",
      },
    ],
    problems: [
      {
        title: "The owner says no email came",
        fix: "Look in their spam folder first. Then send the copied sign-in details by WhatsApp or phone. Ask them to change the password when they first sign in.",
      },
      {
        title: "I approved the wrong request",
        fix: "Open the company under \"Companies\" and use \"Suspend\" until the mistake is sorted out. Do not delete anything.",
      },
    ],
  },

  "floor-tablet-signin": {
    slug: "floor-tablet-signin",
    roles: FLOOR,
    title: "Sign in on the floor tablet",
    when: "Use this at the start of a shift, when you pick up the tablet at the packing or dispatch table.",
    steps: [
      {
        title: "Open orrn",
        body: "Open orrn from the icon on the tablet's home screen. If you see the page for another person, sign them out first.",
      },
      {
        title: "Enter your email and password",
        body: "Type your own work email and password and tap \"Sign in\". Do not use someone else's account, because every bundle and dispatch is recorded against the person who signed in.",
      },
      {
        title: "Enter the code",
        body: "If your account has two-factor on, open your authenticator app, type the 6-digit code and tap \"Verify\". Codes change every 30 seconds, so type the newest one.",
      },
      {
        title: "Check you are in the right plant",
        body: "You land on \"Today\". Check the company name at the top before you pack or dispatch.",
      },
      {
        title: "Choose your language",
        body: "Open \"Account and more\" and choose English or हिंदी under \"Language\". The tablet remembers it.",
      },
      {
        title: "Sign out at the end",
        body: "When you hand the tablet over or finish your shift, open \"Account and more\" and tap \"Sign out\".",
      },
    ],
    problems: [
      {
        title: "\"Email or password is wrong. Check both and try again.\"",
        fix: "Check for a capital letter or an extra space. If it still fails, ask your admin to reset your password.",
      },
      {
        title: "\"Your session ended. Sign in again.\"",
        fix: "Sign in again. Anything you had not saved on the screen may need to be entered again.",
      },
      {
        title: "\"Your account isn't in a company yet\"",
        fix: "You are signed in, but your admin has not added your email to the plant. Ask them to invite you.",
      },
    ],
  },
};
