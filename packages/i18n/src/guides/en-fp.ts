import {
  COUNT_SETTLE,
  CERTIFICATE,
  DIE_ROOM,
  DISPATCH_OFFICE,
  MASTERS,
  ORDER_OFFICE,
  PL_OFFICE,
  PL_REVISE,
  PORTAL,
  PRESS_FLOOR,
  PRESS_LOG,
  READERS,
  REALLOCATE,
  TRIAL,
} from "./fp-roles";
import type { GuideBookFp } from "./types";

/**
 * SOP guides for the FP modules (orders and planning, press, die room, dispatch from an order,
 * count settlement, party portal, reason codes), English. Same rules as en.ts: button, tab and
 * status names sit in straight double quotes and match an en.ts value exactly (parity.test.ts
 * checks this). Roles follow PLANT_ACTION_ROLES in packages/server/src/lib/permissions.ts:
 * the owner holds every action, so the owner is in every list.
 */

export const guidesEnFp: GuideBookFp = {
  "book-order": {
    slug: "book-order",
    roles: ORDER_OFFICE,
    title: "Book and confirm a sales order",
    when: "Use this when a customer sends a purchase order and you need its kg to stay on the books until they are dispatched.",
    steps: [
      {
        title: "Start the order",
        body: "Open \"Orders\" and tap \"New order\". Search for the customer, then type the customer's PO number. The expected date starts a few days after the order date. Change it if the customer wants it sooner or later.",
      },
      {
        title: "Add the die and the lengths",
        body: "Search the die by code or name. Under it, enter each cut length with its pieces or its kg. Press Enter in the pieces or kg box to add the next length. Tap \"Add another die\" for the next section.",
      },
      {
        title: "Read the figures orrn works out",
        body: "Type pieces and orrn gives the kg, or type kg and it gives the pieces. The weight comes from the copy's latest reading, or from the start of the die's band if the copy has none. You never work these out yourself.",
      },
      {
        title: "Book it",
        body: "Tap \"Book order\". The order is saved as \"Booking\" with its own sales order number. Nothing is promised to the floor yet.",
      },
      {
        title: "Put ready stock on a line",
        body: "If bundles of that die are already in the yard, open the line and tap \"Take ready stock\". Plant stock and bundles on no order go on the line at once. Another customer's bundles wait for a manager.",
      },
      {
        title: "Confirm",
        body: "When the PO number and every line are complete, tap \"Confirm order\". If something is missing, orrn lists it. The order is now \"Confirmed\" and its lines can be planned for the press.",
      },
    ],
    problems: [
      {
        title: "It says the PO is already on another order",
        fix: "A PO number can be used once for each customer. Open the order it names. If it was booked twice by mistake, cancel the extra one with \"Cancel order\".",
      },
      {
        title: "The die belongs to another customer",
        fix: "A die that belongs to one customer cannot be booked for another. Ask the die room who owns it, or pick the right customer.",
      },
      {
        title: "I want to change a line after booking",
        fix: "Open the order and tap \"Edit lines\". A line that is already on a released press plan keeps its kg, pieces, length and die. A line cannot go below what is already dispatched.",
      },
    ],
  },

  "hold-for-order": {
    slug: "hold-for-order",
    roles: ORDER_OFFICE,
    title: "Hold yard stock for an order line",
    when: "Use this when finished bundles are lying in the yard and you want to keep them for one customer's order.",
    steps: [
      {
        title: "Open the order",
        body: "Open \"Orders\" and tap the order. Find the line you want the stock to go against.",
      },
      {
        title: "Pick the bundles",
        body: "On that line tap \"Hold stock\". orrn lists yard bundles of the same die that are on no order, or already on this line. Tick the ones you want. A bundle with a different cut length can be held. orrn warns you and holds it anyway.",
      },
      {
        title: "Hold them",
        body: "Confirm the hold. The bundles stay where they are in the yard. While they are held, no other customer's dispatch can take them.",
      },
      {
        title: "Check the line",
        body: "The line shows a \"Held bundles\" list and a count with the kg held. The held kg also show on the order's balance figures.",
      },
      {
        title: "Release when plans change",
        body: "In the \"Held bundles\" list tick the bundles and tap Release, or tap \"Release all\". The bundles are free stock again.",
      },
    ],
    problems: [
      {
        title: "A bundle is not in the list",
        fix: "Only bundles in the yard can be held. A bundle on a dispatch, held for another line, waiting for a move approval or of a different die is left out. The list says why.",
      },
      {
        title: "A scan says the bundle is held for an order",
        fix: "The bundle is held for another customer's line. Choose another bundle, or ask the office to release the hold. Do not force it onto the truck.",
      },
      {
        title: "I held a bundle by mistake",
        fix: "Release it from the \"Held bundles\" list. Voiding a held bundle, or closing or cancelling the order, also releases the hold.",
      },
    ],
  },

  "reallocate-bundles": {
    slug: "reallocate-bundles",
    roles: REALLOCATE,
    title: "Move bundles to another order",
    when: "Use this when finished bundles were packed for one order but should go to another order, or back to plant stock.",
    steps: [
      {
        title: "Open the line they are on",
        body: "Open the order the bundles are on, find the line and tap \"Move bundles\".",
      },
      {
        title: "Choose where they go",
        body: "Under \"Move to\" pick the other order line. Pick \"Plant stock\" if the bundles are free again. Only bundles of the same die can go to an order line.",
      },
      {
        title: "Pick the bundles",
        body: "Tick the bundles to move, or tap \"Select all\". Only available bundles can move. A bundle on a truck or void is greyed out and says why.",
      },
      {
        title: "Give a reason if the length differs",
        body: "If the cut length is not the one on the new line, orrn warns you and asks for a \"Reason\". Pick one from the list or write a note.",
      },
      {
        title: "Move",
        body: "Tap \"Move\". Moving to plant stock or to the same customer's other order happens at once. Moving to another customer's order waits for a manager, and the bundles stay where they are until it is approved.",
      },
    ],
    problems: [
      {
        title: "It says Waiting for a manager",
        fix: "The move is to another customer's order. A manager, admin or owner approves it in \"Approvals\". The order timeline shows the request and, once decided, the move.",
      },
      {
        title: "A bundle cannot be moved",
        fix: "It is dispatched, void, on a live dispatch, or already in a pending move. Remove it from the dispatch first, or wait for the approval.",
      },
      {
        title: "The die belongs to a customer",
        fix: "A bundle of a customer's own die cannot go to another customer. Ask the die room whether an owner exception has been approved.",
      },
    ],
  },

  "plan-press-run": {
    slug: "plan-press-run",
    roles: ORDER_OFFICE,
    title: "Plan the press and release it",
    when: "Use this when confirmed orders have kg still to make and the press needs its list for the next shift or day.",
    steps: [
      {
        title: "Open the plan board",
        body: "Open \"Orders\" and tap \"Press plan\". This page works on a desktop or an 11-inch tablet.",
      },
      {
        title: "Set the window and the press",
        body: "Set \"Window starts\" and \"Window ends\". A window is at most 24 hours. Pick the press under \"Pick the press\".",
      },
      {
        title: "Choose the lines",
        body: "The open lines come grouped by die, so one die serves every customer that needs it. Add the lines you want. Leave the kg blank to plan all that is left, or type fewer kg.",
      },
      {
        title: "Read the other customers",
        body: "When you add a die, orrn lists every other open line on it, with the customer, length and kg still to plan. Add them to press them in the same run. orrn only warns. It never blocks.",
      },
      {
        title: "Save the draft",
        body: "Tap \"Save draft plan\". Reorder the dies with \"Move earlier\" and \"Move later\". Mark one \"Mark urgent\" if it must go first.",
      },
      {
        title: "Release to the press",
        body: "Open the plan and tap \"Release to press\". Each die becomes one queued run on the press. The die room picks the copy when it issues the die.",
      },
    ],
    problems: [
      {
        title: "It says More than the order can still take",
        fix: "The line has less kg left to plan than you asked for. Another plan, a pack or a dispatch already used some. Lower the kg.",
      },
      {
        title: "The die belongs to a customer",
        fix: "A die that belongs to one customer cannot take another customer's line. The line is marked. Plan it on its own, or ask the die room.",
      },
      {
        title: "I need to change a released plan",
        fix: "A draft can be edited. After release, the supervisor moves runs in the press queue, and a cut length can be taken back to planning with \"Take back to planning\". To stop the whole plan, tap \"Cancel plan\" before any die is issued.",
      },
    ],
  },

  "press-station-day": {
    slug: "press-station-day",
    roles: PRESS_FLOOR,
    title: "Run the press at the station",
    when: "Use this at the press tablet, from the moment the die is issued to the moment the run is logged.",
    steps: [
      {
        title: "Open your run",
        body: "Open \"Press\" and tap the press. Tap the run at the top of the queue. If it says the die is not issued, wait for the die room. Start stays locked until they hand it over.",
      },
      {
        title: "Start and stop",
        body: "When the die is in and the billet goes in, tap \"Start\". orrn takes the time from the server clock, not from the tablet. If you stop and start again, tap \"Stop\" and \"Resume\". \"Undo start\" is there for a tap by mistake.",
      },
      {
        title: "Count the run",
        body: "After the press stops, tap \"Count & check\". Step through the billets, the pieces for each cut length, the butt and ends, and the rejects. Type 0 for rejects when there were none. A blank is not a check.",
      },
      {
        title: "Read the figures",
        body: "Recovery and balance come from the server. If the billet stock shows less than you weighed, orrn still logs the weighed kg and asks why. The cast then shows the shortage for the foundry.",
      },
      {
        title: "Hand it to the supervisor",
        body: "Everything you type is saved as you go. The supervisor taps \"Log run\" to finish it. Until then the run is not final.",
      },
      {
        title: "Change of man",
        body: "If another press man takes over, use the handover and name the relief. The run keeps its start time.",
      },
    ],
    problems: [
      {
        title: "Start is locked",
        fix: "The die has not been issued to this run. Ask the die room to issue it. A die issued for another run or press does not unlock this one.",
      },
      {
        title: "It says the tablet clock differs from the server",
        fix: "More than 2 minutes apart. Start and stop still save. A supervisor confirms the times with \"Ask a supervisor to confirm the times\".",
      },
      {
        title: "Log run is greyed out",
        fix: "Only the run's supervisor can log it, and the gates must pass. The close preview lists what is still missing.",
      },
      {
        title: "A figure is wrong after logging",
        fix: "Tap \"Request reopen\" and say why. A manager decides. Do not log a second run to fix it.",
      },
    ],
  },

  "press-late-entry": {
    slug: "press-late-entry",
    roles: PRESS_LOG,
    title: "Enter a run that was done on paper",
    when: "Use this when the tablet was not used and a run that has already stopped has to be put into orrn afterwards.",
    steps: [
      {
        title: "Open the press queue",
        body: "Open \"Press\", tap the press and tap \"Late entry\". Only a run from the last 7 days can be entered late. Older runs are not accepted.",
      },
      {
        title: "Say which run",
        body: "Pick \"A run from the queue\" if the plan was released, or \"A run not in the queue\". For a queued run, pick the die copy that was used.",
      },
      {
        title: "Give the true times",
        body: "Fill in \"Started\" and \"Stopped\" with the real times from the paper, the operator and the relief operator if any. The stop must be after the start and cannot be in the future.",
      },
      {
        title: "Say why it is late",
        body: "Write the reason in \"Why it is entered late\".",
      },
      {
        title: "Enter the run",
        body: "Tap \"Enter the run\". The run is marked \"Entered late\" and waits for a second person to approve. You cannot approve your own.",
      },
      {
        title: "Count and log it",
        body: "Once approved, open the run and count it as usual, then log it. The late share of runs shows on the press summary.",
      },
    ],
    problems: [
      {
        title: "It says the start is too long ago",
        fix: "Late entry is for the last 7 days only. For an older run, ask the manager how to correct the books.",
      },
      {
        title: "No die copy to pick",
        fix: "Only copies of that run's die that are in the rack can be picked. A copy on trial is offered only for a die trial run. Ask the die room.",
      },
      {
        title: "The run is waiting and nothing happens",
        fix: "Ask a manager, a supervisor or the owner to open \"Approvals\" and decide it. You cannot approve your own.",
      },
    ],
  },

  "press-downtime": {
    slug: "press-downtime",
    roles: PRESS_FLOOR,
    title: "Record a press stoppage",
    when: "Use this whenever the press stops for something other than the end of a run, such as a breakdown, a die change or no billets.",
    steps: [
      {
        title: "Open the run",
        body: "Open \"Press\", tap the press and open the run in progress.",
      },
      {
        title: "Start the stoppage",
        body: "Tap \"Press stopped\". Pick the reason from the list. If none fits, pick Other and write a note. The time is taken from the server clock.",
      },
      {
        title: "Fix the fault",
        body: "The stoppage stays open and the tablet shows how long it has been. Only one stoppage can be open on a press.",
      },
      {
        title: "End the stoppage",
        body: "When the press runs again tap \"Press running again\". The minutes are saved against the reason.",
      },
      {
        title: "Check it later",
        body: "The stoppages of the day, longest first, are on the press summary. The supervisor uses them to see where the hours went.",
      },
    ],
    problems: [
      {
        title: "It says a stoppage is already running",
        fix: "Another one is open on this press. End it first with \"Press running again\".",
      },
      {
        title: "I cannot log the run",
        fix: "An open stoppage blocks the close. End it, then count and log again.",
      },
      {
        title: "The reason I need is not in the list",
        fix: "Pick Other and write a note. A manager can add the reason under reason codes.",
      },
    ],
  },

  "die-reading": {
    slug: "die-reading",
    roles: READERS,
    title: "Add a die weight reading",
    when: "Use this after pressing, when you have weighed 12 ft off a die and want its wear recorded.",
    steps: [
      {
        title: "Find the copy",
        body: "Open \"Dies\", search the section, and open the copy you pressed with.",
      },
      {
        title: "Weigh 12 ft",
        body: "Cut 12 ft off the section from that die and weigh it on the bench scale. Write the weight in kg.",
      },
      {
        title: "Add the reading",
        body: "On the \"Readings\" tab tap \"Add reading\" and type the weight of 12 ft. orrn shows the band and the last reading under the box.",
      },
      {
        title: "Save and read the colour",
        body: "Save it. The percent and the colour are worked out by orrn when you save. Green is in range. Amber and red mean the die is wearing and the drift is growing.",
      },
      {
        title: "Tell the die room",
        body: "If the colour is red, tell the die room. A heavier copy may be needed, or the die may need correction.",
      },
    ],
    problems: [
      {
        title: "I typed the wrong weight",
        fix: "A saved reading cannot be edited. Add a new correct reading. The newest one is the one orrn uses.",
      },
      {
        title: "There is no Add reading button",
        fix: "A retired copy takes no readings and keeps its number.",
      },
      {
        title: "It says Trial weight. Not a drift reading.",
        fix: "That figure came from the die maker's trial. It is the starting weight and does not count as wear.",
      },
    ],
  },

  "die-issue-return": {
    slug: "die-issue-return",
    roles: DIE_ROOM,
    title: "Issue a die to the press and take it back",
    when: "Use this when a queued press run is waiting for its die, and again when the run is finished.",
    steps: [
      {
        title: "Open the issue page",
        body: "Open \"Dies\" and tap \"Issue and return\". Pick the press run that is waiting. The run decides the press line.",
      },
      {
        title: "Pick the copy",
        body: "Pick a copy from the rack. orrn lists only copies of the run's section. A copy on trial goes only to a die trial run. A customer's own die goes only to that customer's runs.",
      },
      {
        title: "Issue it",
        body: "Tap \"Issue\". The copy is now on the press line and the run says \"Die issued\". The press can start. A line can hold the running die and one more die for the next run, heated in the oven. A third is refused.",
      },
      {
        title: "Take it back",
        body: "When the run is finished and the die is out, find the copy under \"On a press now\" and tap \"Take back\". It goes back to the rack.",
      },
      {
        title: "Add the reading",
        body: "Weigh 12 ft and add a reading for the copy, so the card shows its wear.",
      },
    ],
    problems: [
      {
        title: "It says the die is still on the press",
        fix: "The run has the die in the press. Take it back after the die is out and the run is logged.",
      },
      {
        title: "I issued the wrong copy",
        fix: "Before the press starts, tap \"Cancel issue\". The copy goes back to the rack and the run waits for a die again.",
      },
      {
        title: "No press run is waiting for this section",
        fix: "Ask the office to release the plan first. A die cannot be issued without a queued run.",
      },
    ],
  },

  "die-trial": {
    slug: "die-trial",
    roles: TRIAL,
    title: "Try a new die copy and release it",
    when: "Use this when a new copy, or a copy back from the die maker, is on trial and has to prove itself before it is used for orders.",
    steps: [
      {
        title: "Know why it is on trial",
        body: "A new copy and a copy back from the die maker start \"On trial\". It goes only to a die trial run, never to a customer order.",
      },
      {
        title: "Get a trial run",
        body: "Ask the office to release a plan with the purpose \"Die trial\". A trial run needs no order line.",
      },
      {
        title: "Issue the copy",
        body: "On the copy tap \"Issue to a trial run\", or use \"Issue and return\" and pick the trial run.",
      },
      {
        title: "Press and decide",
        body: "The supervisor logs the run and says \"Trial passed\" or \"Trial failed\". If it passed, the copy becomes available when it comes back to the rack. If it failed, it stays on trial.",
      },
      {
        title: "Or release it with a reason",
        body: "A manager can tap \"Release without a trial\" and write why. The reason is kept in the audit trail.",
      },
    ],
    problems: [
      {
        title: "The copy is still On trial after a good run",
        fix: "The run's trial result must be set to passed when it is logged. A reopened run puts the copy back on trial.",
      },
      {
        title: "There is no trial run for this section",
        fix: "A copy on trial cannot go on a production run. Ask the office to release a die trial plan for the section.",
      },
      {
        title: "I do not want new copies on trial",
        fix: "The owner or the plant admin can switch \"New copies start on trial\" off on the die board. Do this only if the plant agrees.",
      },
    ],
  },

  "bulk-drawings": {
    slug: "bulk-drawings",
    roles: DIE_ROOM,
    title: "Attach many drawings by file name",
    when: "Use this when the plant's drawing files are named by die or copy code and you want them on the right cards in one go.",
    steps: [
      {
        title: "Name the files",
        body: "A file called 12170.pdf goes to die 12170. A file called 12170-1.cdr goes to copy 12170-1. A PDF becomes the press drawing only if the die has none.",
      },
      {
        title: "Open the bulk page",
        body: "Open \"Dies\", open the menu and tap \"Attach drawings by file name\".",
      },
      {
        title: "Pick the files",
        body: "Pick many files at once. orrn reads the file names and lists what it will attach, what is already there and what it could not match.",
      },
      {
        title: "Attach",
        body: "Check the list and tap the attach button. The files go one at a time, with a count as they go.",
      },
      {
        title: "Read the summary",
        body: "The summary says how many were saved, failed, already there and not matched. Fix the names of the unmatched files and run it again.",
      },
    ],
    problems: [
      {
        title: "A file is Not attached",
        fix: "The reason is written beside it. No die or copy has that code, the file type is not an image, PDF, CDR or DWG, or two dies share the section code. Attach that one from the die itself.",
      },
      {
        title: "Some files failed",
        fix: "The connection dropped. Tap the retry button. The files already saved are not sent again.",
      },
      {
        title: "A file is too big",
        fix: "A PDF can be up to 25 MB, a CDR or DWG up to 40 MB and an image up to 8 MB.",
      },
    ],
  },

  "dispatch-from-order": {
    slug: "dispatch-from-order",
    roles: DISPATCH_OFFICE,
    title: "Start a dispatch from a sales order",
    when: "Use this when a truck is loading for one sales order and you want to see what is left to send as you build the load.",
    steps: [
      {
        title: "Start from the order",
        body: "Open \"Dispatch\" and tap \"New dispatch\". Tap \"From sales order\" and search the order by number, PO or customer. The order's customer becomes the dispatch's customer.",
      },
      {
        title: "Create it",
        body: "Set the ship date if you know it and tap \"Create dispatch\".",
      },
      {
        title: "Let orrn suggest bundles",
        body: "Tap \"Suggest bundles\". orrn lists this order's own stock first, then plant stock of the same die and length. Tick what you want, or add all that fit within the baki.",
      },
      {
        title: "Or scan",
        body: "Scanning works as usual. Each bundle is linked to the order line it belongs to. The panel shows the baki now, what is on this load and what is left after it.",
      },
      {
        title: "Watch the lines",
        body: "Each line shows its baki, the load and what is left. A line that goes past its baki says by how many kg. A bundle whose kg/12ft is far from the line's is marked, and you can still add it.",
      },
      {
        title: "Hold and dispatch",
        body: "Then \"Hold stock\" and \"Dispatch\" as in the other dispatch guide. The packing list comes out with the order and PO on each group.",
      },
    ],
    problems: [
      {
        title: "A bundle is refused for being outside the order",
        fix: "If the plant sends one sales order per packing list, a bundle on another order or of a die this order does not have is refused. Use a bundle of this order or plant stock of the same die.",
      },
      {
        title: "More than the order is being sent",
        fix: "orrn allows a small tolerance on each line. Past it, completing the dispatch asks a manager to approve. Remove bundles or ask the manager.",
      },
      {
        title: "A bundle is held for another order",
        fix: "It is held for another customer's line. Choose another bundle, or ask the office to release the hold.",
      },
    ],
  },

  "truck-capacity": {
    slug: "truck-capacity",
    roles: DISPATCH_OFFICE,
    title: "Set the truck, driver and capacity",
    when: "Use this before a truck leaves, so the vehicle is on the packing list and the load does not go over what the truck can carry.",
    steps: [
      {
        title: "Open the dispatch",
        body: "Open \"Dispatch\" and tap the dispatch. Tap \"Edit details\".",
      },
      {
        title: "Fill the vehicle",
        body: "Type the \"Vehicle number\", the driver and the driver's phone. Pick the transporter, or add one with \"Add transporter\". The vehicle number and driver print on the packing list.",
      },
      {
        title: "Set the capacity",
        body: "Type the \"Truck capacity (kg)\". The page shows how full the truck is as you add bundles. Leave it blank for no warning.",
      },
      {
        title: "Save",
        body: "Tap \"Save details\". The capacity is a warning while you load. It does not stop you adding bundles.",
      },
      {
        title: "If it goes over",
        body: "When the load is over capacity, orrn asks you to say why before you can dispatch. The reason is kept with the dispatch.",
      },
    ],
    problems: [
      {
        title: "Several customers are on one truck",
        fix: "If the plant allows it, tap \"Add another customer to this truck\". Each customer keeps its own packing list. The vehicle, driver and capacity belong to the truck, and the capacity counts the whole truck.",
      },
      {
        title: "I changed the capacity after the dispatch",
        fix: "The capacity this load went against stays as it was. orrn keeps it with the dispatch.",
      },
      {
        title: "The vehicle number looks different",
        fix: "orrn drops spaces and dashes and keeps only letters and digits, so a number typed with spaces is stored without them.",
      },
    ],
  },

  "packing-list-revisions": {
    slug: "packing-list-revisions",
    roles: PL_REVISE,
    title: "Correct a packing list with a new revision",
    when: "Use this when a packing list that was already sent needs to change, for example a bundle was swapped or a weight was corrected.",
    steps: [
      {
        title: "Open the packing list",
        body: "Open \"Dispatch\", open the completed dispatch and open its packing list.",
      },
      {
        title: "Look at what is sent",
        body: "The list shows its revision number. A revision that was already sent stays readable and is marked \"Sent earlier\".",
      },
      {
        title: "Make the revision",
        body: "Tap \"Make a new revision\" and confirm. orrn builds the list again from the bundles as they are now. The PL number does not change.",
      },
      {
        title: "Check what changed",
        body: "The page lists the changes from the earlier revision: bundles added, removed or changed. Read them before you send.",
      },
      {
        title: "Print and send",
        body: "Download the PDF or Excel as usual. Tell the customer that this revision replaces the one sent before.",
      },
    ],
    problems: [
      {
        title: "There is no Make a new revision button",
        fix: "Only people who can complete a dispatch can make one. A list that was combined with others cannot be remade from its parts.",
      },
      {
        title: "The number on the list looks wrong",
        fix: "Make sure the dispatch holds the right bundles first. A new revision reads the bundles as they are now, so a wrong bundle gives a wrong list.",
      },
      {
        title: "I need to see the old list",
        fix: "Open \"Revisions\" and pick the earlier one. Nothing is deleted.",
      },
    ],
  },

  "combine-packing-lists": {
    slug: "combine-packing-lists",
    roles: PL_OFFICE,
    title: "Combine packing lists into one",
    when: "Use this when one customer's trucks went out on different days and they want one list for all of them.",
    steps: [
      {
        title: "Open one of the lists",
        body: "Open \"Dispatch\", open a completed dispatch of the customer and open its packing list.",
      },
      {
        title: "Start the combine",
        body: "Tap \"Combine lists\". orrn shows the customer's other lists that are not already combined.",
      },
      {
        title: "Pick the lists",
        body: "Tick the lists to fold in. All must belong to the same customer and to completed dispatches.",
      },
      {
        title: "Combine",
        body: "Tap the combine button. The new list takes a new PL number. Each folded list keeps its own number and shows \"Combined\".",
      },
      {
        title: "Print it",
        body: "Download the PDF or Excel of the new list. It carries every bundle from the folded lists, grouped by order line.",
      },
    ],
    problems: [
      {
        title: "No other list to combine",
        fix: "The customer has no other completed, uncombined list. Check that the other dispatch is completed.",
      },
      {
        title: "I combined the wrong lists",
        fix: "A combined list cannot be undone or remade from its parts. Ask a manager before you combine.",
      },
      {
        title: "A list is missing the vehicle",
        fix: "Each folded list kept its own header. Open the truck's own dispatch to correct a vehicle, then make a new revision of that list.",
      },
    ],
  },

  "settle-count": {
    slug: "settle-count",
    roles: COUNT_SETTLE,
    title: "Settle a closed stock count",
    when: "Use this after a count is closed, to deal with the bundles that were missing or found in the wrong yard.",
    steps: [
      {
        title: "Open the closed count",
        body: "Open \"Stock\", then \"Stock count\", and open the closed count under \"Earlier counts\".",
      },
      {
        title: "Read the report",
        body: "The report shows what was missing, found and moved, and the difference by yard and by section. Bundles packed or moved during the count are not counted as missing.",
      },
      {
        title: "Move what was found",
        body: "For bundles found in another yard, use the move button. They go to the yard where they were seen, and the move is on the ledger.",
      },
      {
        title: "Ask to void what is really gone",
        body: "Look again in the nearby yards. For bundles that are truly missing, ask to void them. A manager is asked to approve. Until then they stay in stock.",
      },
      {
        title: "Check the number",
        body: "The missing figure on Today and on \"Stock count\" falls as bundles are voided, found or cleared.",
      },
    ],
    problems: [
      {
        title: "The bundle was seen in another count",
        fix: "A bundle that another count saw is not missing. The report says where. Move it from that count instead of voiding it.",
      },
      {
        title: "The approval was refused",
        fix: "The bundle was packed or moved after the count closed, so it is no longer missing. Nothing is voided.",
      },
      {
        title: "Closing a count did not change the stock",
        fix: "That is right. Closing freezes the report. Only an approved void or a move changes the ledger.",
      },
    ],
  },

  "portal-login": {
    slug: "portal-login",
    roles: PORTAL,
    title: "Give a customer a party login",
    when: "Use this when a customer should see their own dies, book orders and see what was dispatched to them.",
    steps: [
      {
        title: "Turn the portal on",
        body: "Open \"Settings\" and turn on \"Party portal\" in the switches. This is once for the plant.",
      },
      {
        title: "Open the customer",
        body: "Open \"Customers\" and open the party. Find \"Portal access\".",
      },
      {
        title: "Give a login",
        body: "Tap \"Give a login\", type the party's email and tap \"Give login\". orrn makes an invite link that works for 7 days.",
      },
      {
        title: "Send the link",
        body: "Copy the invite link with \"Copy link\" and send it to the party. Email is not always reliable, so send the link yourself.",
      },
      {
        title: "Open the dies",
        body: "Under \"Dies the party sees\" tap \"Open a die\" for each die the party may book. A die owned by another customer is never shown.",
      },
      {
        title: "Turn it off if needed",
        body: "Tap \"Turn off\" to stop a login. \"Turn on\" brings it back with no new invite.",
      },
    ],
    problems: [
      {
        title: "This email is a plant login",
        fix: "A person cannot be staff and a party in the same plant. Use another email for the party.",
      },
      {
        title: "The party sees no dies",
        fix: "A party sees the dies it owns and those you open for it. Open the dies, and check the party portal switch.",
      },
      {
        title: "The party books an order",
        fix: "It arrives as \"Booking\" marked Portal. Open it, check the lines and confirm it like any other order.",
      },
    ],
  },

  "issue-certificate": {
    slug: "issue-certificate",
    roles: CERTIFICATE,
    title: "Issue a test certificate",
    when: "Use this when a customer needs a test certificate for a dispatch that has gone out.",
    steps: [
      {
        title: "Open the dispatch",
        body: "Open \"Dispatch\", and open the completed dispatch.",
      },
      {
        title: "Issue it",
        body: "Tap \"Issue test certificate\". The certificate takes the next number and cites the casts behind the bundles with each cast's chemistry.",
      },
      {
        title: "Read the chemistry",
        body: "Casts that have not been tested yet are shown as pending. orrn never invents a figure.",
      },
      {
        title: "The customer sees it",
        body: "If the customer has a party login, the certificate shows under the dispatch in their portal. It carries no rate.",
      },
      {
        title: "Issue again",
        body: "If something changed, tap \"Issue again\". The new revision keeps the same certificate number.",
      },
    ],
    problems: [
      {
        title: "Chemistry pending",
        fix: "No spectrometer result is attached to the cast yet. The foundry attaches it. Issue again when it is there.",
      },
      {
        title: "Some bundles have no cast number",
        fix: "The certificate says how many. Those bundles were packed without a cast.",
      },
      {
        title: "There is no button",
        fix: "Only the office, a manager, an admin or the owner can issue it, or a person who can complete dispatches.",
      },
    ],
  },

  "reason-codes": {
    slug: "reason-codes",
    roles: MASTERS,
    title: "Manage the reason codes",
    when: "Use this when the floor needs a new reason in a list, such as why a press stopped or why a bundle was voided.",
    steps: [
      {
        title: "Open the reasons",
        body: "Open \"Masters\" and the reason codes page. Pick the kind of reason: downtime, rejects, void, reprint or move to another order.",
      },
      {
        title: "Add a reason",
        body: "Add the reason in English. Type the Hindi and Gujarati words too, so the floor sees it in their language. The key is made from the English words once and never changes.",
      },
      {
        title: "Ask for a note if needed",
        body: "Switch on the note box for a reason that needs explaining. Other is fixed in every kind. It always asks for a note.",
      },
      {
        title: "Rename or retire",
        body: "Renaming changes the words, not the key. A retired reason leaves the pickers but stays on old records. It can be turned on again.",
      },
    ],
    problems: [
      {
        title: "A standard reason shows in English",
        fix: "A reason you renamed shows the words you typed. Type the Hindi and Gujarati words for it.",
      },
      {
        title: "I cannot rename Other",
        fix: "Other is fixed so that there is always a way out. Add a more exact reason instead.",
      },
      {
        title: "Nothing changes on the tablet",
        fix: "The list loads when the press page opens. Reload the page.",
      },
    ],
  },
};
