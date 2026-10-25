# Hindi review

For Lalubhai. Every Hindi string in orrn, next to the English it comes from.

This file is generated from `packages/i18n` by `bun run --cwd packages/i18n export-review`. Don't edit it by hand. Send corrections as "key: new Hindi" (for example `pack.new.saveBundle: Bundle सेव करो`) and we update `hi.ts` and regenerate.

What to check:

1. Would someone on the floor understand it on first read?
2. Is it the word the plant actually uses? (for example ग्राहक or पार्टी, रद्द or कैंसल)
3. Words kept in English on purpose: bundle, die, dispatch, PO, kg, kg/12ft, serial numbers, codes, numbers, orrn. Tell us if any of these should be Hindi, or if more words should stay English.

Counts: 6111 screen strings in 49 groups, 35 guides with 646 strings.

## Screen strings

### common (69)

| Key | English | हिंदी |
|---|---|---|
| `appName` | orrn | orrn |
| `save` | Save | सेव करें |
| `saving` | Saving | सेव हो रहा है |
| `saved` | Saved | सेव हो गया |
| `cancel` | Cancel | रहने दें |
| `showingOf` | Showing {shown} of {total}, type to find | {total} में से {shown} दिख रहे हैं, ढूंढने के लिए लिखें |
| `close` | Close | बंद करें |
| `back` | Back | वापस |
| `next` | Next | आगे |
| `done` | Done | हो गया |
| `edit` | Edit | बदलें |
| `remove` | Remove | हटाएं |
| `delete` | Delete | डिलीट करें |
| `add` | Add | जोड़ें |
| `create` | Create | बनाएं |
| `confirm` | Confirm | पक्का करें |
| `continue` | Continue | आगे बढ़ें |
| `search` | Search | खोजें |
| `filter` | Filter | फ़िल्टर |
| `sort` | Sort | क्रम से लगाएं |
| `sortMostKg` | Most kg | सबसे ज़्यादा kg |
| `sortAZ` | A to Z | A से Z |
| `all` | All | सभी |
| `loading` | Loading | लोड हो रहा है |
| `retry` | Try again | फिर से कोशिश करें |
| `more` | More | और |
| `moreActions` | More actions | और विकल्प |
| `howTo` | How to | कैसे करें |
| `optional` | Optional | ज़रूरी नहीं |
| `required` | Required | ज़रूरी |
| `yes` | Yes | हाँ |
| `no` | No | नहीं |
| `notes` | Notes | नोट |
| `details` | Details | जानकारी |
| `advanced` | Advanced | एडवांस |
| `print` | Print | प्रिंट करें |
| `download` | Download | डाउनलोड करें |
| `share` | Share | शेयर करें |
| `copy` | Copy | कॉपी करें |
| `copied` | Copied | कॉपी हो गया |
| `showMore` | Show more | और दिखाएं |
| `previousPage` | Previous page | पिछला पेज |
| `nextPage` | Next page | अगला पेज |
| `pageRange` | {from}-{to} of {total} | {total} में से {from}-{to} |
| `today` | Today | आज |
| `yesterday` | Yesterday | कल |
| `total` | Total | कुल |
| `language` | Language | भाषा |
| `english` | English | English |
| `hindi` | हिंदी | हिंदी |
| `theme` | Theme | थीम |
| `themeSystem` | Match device | डिवाइस के हिसाब से |
| `themeLight` | Light | लाइट |
| `themeDark` | Dark | डार्क |
| `openMenu` | Open menu | मेन्यू खोलें |
| `demoData` | Demo data | डेमो डेटा |
| `noResults` | Nothing matches "{query}" | "{query}" से कुछ नहीं मिला |
| `by` | by {name} | {name} द्वारा |
| `gujarati` | ગુજરાતી | ગુજરાતી |
| `reason` | Reason | कारण |
| `note` | Note | नोट |
| `noteRequired` | Write a note when you pick Other. | अन्य चुनें तो नोट लिखें। |
| `noteRequiredReason` | This reason needs a note. | इस कारण के साथ नोट लिखें। |
| `other` | Other | अन्य |
| `shift` | Shift | शिफ्ट |
| `productionDay` | Production day | प्रोडक्शन का दिन |
| `askApproval` | Ask for approval | मंज़ूरी मांगें |
| `waitingApproval` | Waiting for approval | मंज़ूरी का इंतज़ार |
| `plant` | Plant | प्लांट |

### units (16)

| Key | English | हिंदी |
|---|---|---|
| `kg` | kg | kg |
| `g` | g | g |
| `kgPer12ft` | kg/12ft | kg/12ft |
| `pcs` | pcs | pcs |
| `mm` | mm | mm |
| `inch` | in | in |
| `ft` | ft | ft |
| `min` | min | मिनट |
| `bundles` | {count} {count:bundle\|bundles} | {count} bundle |
| `pieces` | {count} {count:piece\|pieces} | {count} पीस |
| `bundlesKg` | {bundles} {bundles:bundle\|bundles} · {kg} kg | {bundles} bundle · {kg} kg |
| `feetInches` | {ft} ft {in} in | {ft} ft {in} in |
| `kgPerM` | kg/m | kg/m |
| `percent` | {value}% | {value}% |
| `rangeTo` | {min} to {max} | {min} से {max} |
| `kgPerMetre` | kg/m | kg/m |

### status (31)

| Key | English | हिंदी |
|---|---|---|
| `bundle.available` | In stock | स्टॉक में |
| `bundle.reserved` | Held | होल्ड पर |
| `bundle.dispatched` | Dispatched | Dispatch हो गया |
| `bundle.void` | Void | रद्द |
| `dispatch.draft` | Building | बन रहा है |
| `dispatch.reserved` | Held | होल्ड पर |
| `dispatch.completed` | Dispatched | Dispatch हो गया |
| `dispatch.cancelled` | Cancelled | कैंसल |
| `die.active` | Active | चालू |
| `die.archived` | Archived | बंद |
| `range.inRange` | In range | रेंज में |
| `range.below` | Below range | रेंज से कम |
| `range.above` | Above range | रेंज से ज़्यादा |
| `range.noRange` | No range set | रेंज नहीं डाली |
| `printJob.queued` | Waiting | इंतज़ार में |
| `printJob.sent` | Sent to printer | प्रिंटर को भेजा |
| `printJob.success` | Printed | प्रिंट हो गया |
| `printJob.failed` | Failed | फ़ेल |
| `printer.online` | Online | ऑनलाइन |
| `printer.offline` | Offline | ऑफ़लाइन |
| `printSetup.pending` | Waiting to connect | जुड़ने का इंतज़ार |
| `printSetup.active` | Connected | जुड़ा है |
| `printSetup.offline` | Not connected | जुड़ा नहीं है |
| `printSetup.revoked` | Turned off | बंद किया गया |
| `printSetup.none` | Not set up | सेट नहीं है |
| `request.pending` | Waiting | इंतज़ार में |
| `request.approved` | Approved | मंज़ूर |
| `request.rejected` | Rejected | नामंज़ूर |
| `company.active` | Active | चालू |
| `company.suspended` | Suspended | रोकी गई |
| `company.pending` | Waiting for approval | मंज़ूरी बाकी |

### roles (13)

| Key | English | हिंदी |
|---|---|---|
| `owner` | Owner | मालिक |
| `admin` | Admin | एडमिन |
| `manager` | Manager | मैनेजर |
| `office` | Office | ऑफ़िस |
| `accountant` | Accountant | अकाउंटेंट |
| `supervisor` | Supervisor | सुपरवाइज़र |
| `packer` | Packer | पैकर |
| `foundry` | Foundry | फाउंड्री |
| `press` | Press | प्रेस |
| `storekeeper` | Storekeeper | स्टोरकीपर |
| `die_room` | Die room | डाई रूम |
| `operator` | Operator | ऑपरेटर |
| `viewer` | Viewer | व्यूअर |

### platformRoles (3)

| Key | English | हिंदी |
|---|---|---|
| `super_admin` | Super admin | सुपर एडमिन |
| `admin` | Admin | एडमिन |
| `support` | Support | सपोर्ट |

### nav (53)

| Key | English | हिंदी |
|---|---|---|
| `main` | Main | मुख्य |
| `today` | Today | आज |
| `pack` | Pack | पैकिंग |
| `scan` | Scan | स्कैन |
| `stock` | Stock | स्टॉक |
| `dispatch` | Dispatch | Dispatch |
| `more` | More | और |
| `orders` | Orders | ऑर्डर |
| `foundry` | Foundry | फाउंड्री |
| `dies` | Dies | Die |
| `customers` | Customers | ग्राहक |
| `store` | Store | स्टोर |
| `printing` | Printing | प्रिंटिंग |
| `masters` | Masters | मास्टर |
| `guides` | Guides | गाइड |
| `settings` | Settings | सेटिंग्स |
| `account` | Account | अकाउंट |
| `signOut` | Sign out | साइन आउट |
| `skipToContent` | Skip to content | मुख्य हिस्से पर जाएं |
| `scanOrSearch` | Scan or search | स्कैन करें या खोजें |
| `paletteHint` | Type a serial, dispatch code, die or customer | Serial, dispatch कोड, die या ग्राहक लिखें |
| `palettePages` | Pages | पेज |
| `paletteBundles` | Bundles | Bundle |
| `paletteDispatches` | Dispatches | Dispatch |
| `paletteDies` | Dies | Die |
| `paletteCustomers` | Customers | ग्राहक |
| `signedInAs` | Signed in as {email} | {email} से साइन इन |
| `adminOverview` | Overview | सारांश |
| `adminCompanies` | Companies | कंपनियां |
| `adminRequests` | Access requests | एक्सेस रिक्वेस्ट |
| `adminRequestsShort` | Requests | रिक्वेस्ट |
| `adminStaff` | Staff | स्टाफ़ |
| `openAccount` | Account and more | अकाउंट और बाकी पेज |
| `plantSwitch.label` | Switch plant | प्लांट बदलें |
| `plantSwitch.current` | Plant: {name} | प्लांट: {name} |
| `plantSwitch.heading` | Your plants | आपके प्लांट |
| `plantSwitch.switching` | Opening {name} | {name} खुल रहा है |
| `plantSwitch.failed` | Could not open that plant. Try again. | वह प्लांट नहीं खुला। फिर से कोशिश करें। |
| `home` | orrn home | orrn होम |
| `godseye` | Godseye | Godseye |
| `godseyeHome` | Godseye home | Godseye होम |
| `paletteOpenBundle` | Open bundle {serial} | Bundle {serial} खोलें |
| `paletteResults` | {count} {count:result\|results} | {count} {count:नतीजा\|नतीजे} |
| `paletteMove` | Move | ऊपर-नीचे जाएं |
| `paletteOpen` | Open | खोलें |
| `purchase` | Purchase | खरीद |
| `approvals` | Approvals | मंज़ूरी |
| `audit` | Audit log | ऑडिट लॉग |
| `adminReleases` | App builds | ऐप बिल्ड |
| `adminBackups` | Backups | बैकअप |
| `adminSupport` | Support | सपोर्ट |
| `press` | Press | प्रेस |
| `reports` | Reports | रिपोर्ट |

### auth (114)

| Key | English | हिंदी |
|---|---|---|
| `login.title` | Sign in | साइन इन करें |
| `login.subtitle` | Use your work email. | अपना काम का ईमेल डालें। |
| `login.email` | Email | ईमेल |
| `login.password` | Password | पासवर्ड |
| `login.submit` | Sign in | साइन इन करें |
| `login.submitting` | Signing in | साइन इन हो रहा है |
| `login.wrongCredentials` | Email or password is wrong. Check both and try again. | ईमेल या पासवर्ड गलत है। दोनों जांचें और फिर से कोशिश करें। |
| `login.newHere` | New to orrn? | orrn पर नए हैं? |
| `login.requestAccess` | Request access | एक्सेस मांगें |
| `login.showPassword` | Show password | पासवर्ड दिखाएं |
| `login.forgot` | Forgot password? | पासवर्ड भूल गए? |
| `totp.title` | Enter your code | अपना कोड डालें |
| `totp.body` | Open your authenticator app and type the 6-digit code for orrn. | अपना authenticator ऐप खोलें और orrn वाला 6 अंकों का कोड लिखें। |
| `totp.code` | 6-digit code | 6 अंकों का कोड |
| `totp.submit` | Verify | जांचें |
| `totp.verifying` | Checking | जांच हो रही है |
| `totp.wrongCode` | That code didn't work. Codes change every 30 seconds, so type the newest one. | यह कोड नहीं चला। कोड हर 30 सेकंड में बदलता है, इसलिए सबसे नया कोड डालें। |
| `totp.codeRequired` | Type all 6 digits. | पूरे 6 अंक लिखें। |
| `totp.trust` | Trust this device for 30 days | इस डिवाइस पर 30 दिन तक भरोसा रखें |
| `totp.useBackup` | Use a backup code instead | इसकी जगह बैकअप कोड इस्तेमाल करें |
| `totp.useApp` | Use the authenticator app instead | इसकी जगह authenticator ऐप इस्तेमाल करें |
| `totp.backupTitle` | Enter a backup code | बैकअप कोड डालें |
| `totp.backupBody` | Type one of the backup codes you saved when you turned on two-factor. Each one works once. | टू-फ़ैक्टर चालू करते समय जो बैकअप कोड सेव किए थे, उनमें से एक लिखें। हर कोड एक बार ही चलता है। |
| `totp.backupCode` | Backup code | बैकअप कोड |
| `totp.backupRequired` | Type a backup code. | बैकअप कोड लिखें। |
| `totp.wrongBackup` | That backup code didn't work. Check it, or use one you haven't used yet. | यह बैकअप कोड नहीं चला। इसे जांचें, या कोई ऐसा कोड डालें जो पहले इस्तेमाल नहीं हुआ। |
| `totp.back` | Back to password | पासवर्ड पर वापस |
| `validation.email` | Enter your email. | अपना ईमेल डालें। |
| `validation.password` | Enter your password. | अपना पासवर्ड डालें। |
| `validation.passwordShort` | Use at least 8 characters. | कम से कम 8 अक्षर रखें। |
| `validation.name` | Enter your name. | अपना नाम डालें। |
| `validation.company` | Enter your company's name. | अपनी कंपनी का नाम डालें। |
| `errors.tooMany` | Too many tries. Wait a minute, then try again. | बहुत बार कोशिश हो गई। एक मिनट रुकें, फिर कोशिश करें। |
| `errors.twoFactorExpired` | That took too long. Sign in again with your password. | बहुत देर हो गई। अपने पासवर्ड से फिर से साइन इन करें। |
| `brand.label` | How orrn works | orrn कैसे काम करता है |
| `brand.holdStep` | Hold | होल्ड |
| `brand.pack` | Weight and pieces in, label out. | वज़न और पीस डालें, लेबल निकालें। |
| `requestAccess.title` | Request access | एक्सेस मांगें |
| `requestAccess.subtitle` | Tell us about your plant and we'll get in touch to set up your company. | अपने प्लांट के बारे में बताएं। आपकी कंपनी सेट करने के लिए हम संपर्क करेंगे। |
| `requestAccess.company` | Company name | कंपनी का नाम |
| `requestAccess.name` | Your name | आपका नाम |
| `requestAccess.workEmail` | Work email | काम का ईमेल |
| `requestAccess.lines` | Extrusion lines | एक्सट्रूज़न लाइनें |
| `requestAccess.slotTitle` | When could we show you orrn? | हम आपको orrn कब दिखा सकते हैं? |
| `requestAccess.slotHint` | Optional. We'll confirm the time by email. | ज़रूरी नहीं। समय हम ईमेल से पक्का करेंगे। |
| `requestAccess.preferredDate` | Preferred date | पसंद की तारीख |
| `requestAccess.preferredTime` | Preferred time | पसंद का समय |
| `requestAccess.notes` | Anything else we should know | और कुछ जो हमें पता होना चाहिए |
| `requestAccess.notesHint` | Optional. Up to {max} characters. | ज़रूरी नहीं। ज़्यादा से ज़्यादा {max} अक्षर। |
| `requestAccess.submit` | Send request | रिक्वेस्ट भेजें |
| `requestAccess.submitting` | Sending | भेज रहे हैं |
| `requestAccess.failed` | The request didn't send. Check the fields and try again. | रिक्वेस्ट नहीं गई। जानकारी जांचें और फिर से कोशिश करें। |
| `requestAccess.successTitle` | Request sent | रिक्वेस्ट भेज दी |
| `requestAccess.successBody` | We have your request. We'll reply to {email}. | आपकी रिक्वेस्ट मिल गई। हम {email} पर जवाब देंगे। |
| `requestAccess.backHome` | Back to home | होम पर वापस |
| `invite.genericTitle` | Join your team on orrn | orrn पर अपनी टीम से जुड़ें |
| `invite.genericBody` | Use the email address your invite was sent to. | वही ईमेल डालें जिस पर आपका इनवाइट आया है। |
| `invite.name` | Your name | आपका नाम |
| `invite.email` | Email | ईमेल |
| `invite.password` | Password | पासवर्ड |
| `invite.passwordHint` | At least 8 characters. | कम से कम 8 अक्षर। |
| `invite.submit` | Create account and join | अकाउंट बनाएं और जुड़ें |
| `invite.submitting` | Joining | जुड़ रहे हैं |
| `invite.signInSubmit` | Sign in and join | साइन इन करें और जुड़ें |
| `invite.existingAccount` | This email already has an account. Sign in to join. | इस ईमेल का अकाउंट पहले से है। जुड़ने के लिए साइन इन करें। |
| `invite.signedInAs` | You're signed in as {email}. | आप {email} से साइन इन हैं। |
| `invite.joinAsMe` | Join with this account | इसी अकाउंट से जुड़ें |
| `invite.otherAccount` | Use another account | दूसरा अकाउंट इस्तेमाल करें |
| `invite.joined` | Joined | जुड़ गए |
| `invite.expiredTitle` | This invite link doesn't work | यह इनवाइट लिंक काम नहीं कर रहा |
| `invite.expired` | This invite link has expired or was already used. Ask your admin for a new one. | यह इनवाइट लिंक पुराना हो गया है या पहले ही इस्तेमाल हो चुका है। अपने एडमिन से नया लिंक मांगें। |
| `invite.wrongEmailTitle` | This invite is for a different email | यह इनवाइट किसी दूसरे ईमेल के लिए है |
| `invite.wrongEmail` | Sign out, then open the link again and use the email the invite was sent to. | साइन आउट करें, फिर लिंक दोबारा खोलें और वही ईमेल डालें जिस पर इनवाइट आया था। |
| `invite.goSignIn` | Go to sign in | साइन इन पर जाएं |
| `continue.title` | Your workspace is ready | आपका वर्कस्पेस तैयार है |
| `continue.body` | Tap Continue to sign in and set your password. | साइन इन करके पासवर्ड बनाने के लिए आगे बढ़ें दबाएं। |
| `continue.button` | Continue | आगे बढ़ें |
| `continue.brokenTitle` | This link no longer works | यह लिंक अब काम नहीं करता |
| `continue.brokenBody` | It was already used or has expired. Ask the person who sent it for a new sign-in link. | यह पहले ही इस्तेमाल हो चुका है या खत्म हो गया है। जिसने भेजा था उनसे नया साइन इन लिंक मांगें। |
| `continue.goSignIn` | Go to sign in | साइन इन पर जाएं |
| `continue.refusedTitle` | Sign in with your password | अपने पासवर्ड से साइन इन करें |
| `continue.refusedBody` | This account already has a password and an authenticator code, so a sign-in link can't open it. Sign in with your password. If you forgot it, choose a new one. | इस अकाउंट में पासवर्ड और ऑथेंटिकेटर कोड है, इसलिए साइन इन लिंक से यह नहीं खुलेगा। पासवर्ड से साइन इन करें। भूल गए हों तो नया पासवर्ड चुनें। |
| `continue.forgotLink` | Forgot password | पासवर्ड भूल गए |
| `forgot.title` | Forgot your password? | पासवर्ड भूल गए? |
| `forgot.body` | Enter your work email. If an account exists, we'll send a link to choose a new password. | अपना वर्क ईमेल लिखें। अकाउंट होगा तो नया पासवर्ड चुनने का लिंक भेज देंगे। |
| `forgot.submit` | Send reset link | रीसेट लिंक भेजें |
| `forgot.submitting` | Sending | भेज रहे हैं |
| `forgot.sentTitle` | Check your email | अपना ईमेल देखें |
| `forgot.sentBody` | If an account exists for {email}, a link to choose a new password is on its way. It works for one hour. | {email} का अकाउंट होगा तो नया पासवर्ड चुनने का लिंक भेजा जा रहा है। यह एक घंटे तक चलता है। |
| `forgot.failed` | The request didn't send. Check your connection and try again. | अनुरोध नहीं गया। कनेक्शन देखकर फिर कोशिश करें। |
| `forgot.back` | Back to sign in | साइन इन पर वापस |
| `reset.title` | Choose a new password | नया पासवर्ड चुनें |
| `reset.body` | Use at least 8 characters. You will be signed out on every device. | कम से कम 8 अक्षर रखें। हर डिवाइस से साइन आउट हो जाएगा। |
| `reset.password` | New password | नया पासवर्ड |
| `reset.confirm` | Type it again | दोबारा लिखें |
| `reset.mismatch` | The two passwords don't match. | दोनों पासवर्ड एक जैसे नहीं हैं। |
| `reset.submit` | Save password | पासवर्ड सेव करें |
| `reset.saving` | Saving | सेव हो रहा है |
| `reset.doneTitle` | Password changed | पासवर्ड बदल गया |
| `reset.doneBody` | Sign in with your new password. If you use an authenticator app, you will still need its code. | नए पासवर्ड से साइन इन करें। ऑथेंटिकेटर ऐप है तो उसका कोड भी लगेगा। |
| `reset.badTitle` | This link no longer works | यह लिंक अब नहीं चलता |
| `reset.badBody` | It was already used or has expired. Ask for a new reset link. | यह पहले ही इस्तेमाल हो चुका है या खत्म हो गया है। नया रीसेट लिंक मांगें। |
| `reset.askAgain` | Send a new link | नया लिंक भेजें |
| `reset.failed` | The password didn't change. Try again, or ask for a new link. | पासवर्ड नहीं बदला। फिर कोशिश करें या नया लिंक मांगें। |
| `reset.goSignIn` | Go to sign in | साइन इन पर जाएं |
| `noAccess.title` | Your account isn't in a company yet | आपका अकाउंट अभी किसी कंपनी में नहीं है |
| `noAccess.body` | You're signed in as {email}. | आप {email} से साइन इन हैं। |
| `noAccess.signedInLabel` | Signed in as | इस ईमेल से साइन इन हैं |
| `noAccess.ask` | Ask your admin to invite this email. | अपने एडमिन से इस ईमेल को इनवाइट करने के लिए कहें। |
| `noAccess.copyEmail` | Copy email | ईमेल कॉपी करें |
| `noAccess.switchAccount` | Sign out and use another account | साइन आउट करें और दूसरा अकाउंट इस्तेमाल करें |
| `noAccess.ownPlant` | Setting up orrn for your own plant? | अपने प्लांट के लिए orrn शुरू करना है? |
| `sessionExpired` | Your session ended. Sign in again. | आपका सेशन खत्म हो गया। फिर से साइन इन करें। |
| `signOut` | Sign out | साइन आउट |

### welcome (58)

| Key | English | हिंदी |
|---|---|---|
| `steps.password` | Password | पासवर्ड |
| `steps.twoFactor` | Two-factor | टू-फ़ैक्टर |
| `steps.company` | Company details | कंपनी की जानकारी |
| `steps.done` | Done | हो गया |
| `password.title` | Set your password | अपना पासवर्ड बनाएं |
| `password.body` | You'll use this with your email to sign in. | साइन इन करने के लिए आप ईमेल के साथ यही पासवर्ड डालेंगे। |
| `password.forcedBody` | Your admin gave you a temporary password. Choose your own to continue. | आपके एडमिन ने आपको कुछ समय का पासवर्ड दिया था। आगे बढ़ने के लिए अपना पासवर्ड बनाएं। |
| `password.newPassword` | New password | नया पासवर्ड |
| `password.confirmPassword` | Type it again | फिर से लिखें |
| `password.hint` | At least 8 characters. | कम से कम 8 अक्षर। |
| `password.mismatch` | The two passwords don't match. | दोनों पासवर्ड एक जैसे नहीं हैं। |
| `password.submit` | Save password | पासवर्ड सेव करें |
| `password.submitting` | Saving | सेव हो रहा है |
| `password.alreadySet` | This account already has a password, so we kept it. Use that one to sign in. | इस अकाउंट का पासवर्ड पहले से है, इसलिए वही रखा है। साइन इन के लिए वही डालें। |
| `twoFactor.title` | Turn on two-factor | टू-फ़ैक्टर चालू करें |
| `twoFactor.body` | Scan this QR code with an authenticator app, then type the 6-digit code it shows. | इस QR कोड को authenticator ऐप से स्कैन करें, फिर ऐप में दिख रहा 6 अंकों का कोड लिखें। |
| `twoFactor.confirmBody` | Type your password to get your QR code. | QR कोड पाने के लिए अपना पासवर्ड लिखें। |
| `twoFactor.confirmPassword` | Your password | आपका पासवर्ड |
| `twoFactor.showQr` | Show QR code | QR कोड दिखाएं |
| `twoFactor.wrongPassword` | That password is wrong. Type the password you sign in with. | यह पासवर्ड गलत है। वही पासवर्ड लिखें जिससे आप साइन इन करते हैं। |
| `twoFactor.loading` | Getting your QR code | आपका QR कोड आ रहा है |
| `twoFactor.qrAlt` | QR code for your authenticator app | आपके authenticator ऐप के लिए QR कोड |
| `twoFactor.newQr` | This is a new QR code. A code you added to your app before won't work, so scan this one. | यह नया QR कोड है। ऐप में पहले जोड़ा गया कोड अब काम नहीं करेगा, इसलिए इसे स्कैन करें। |
| `twoFactor.manualKey` | Can't scan it? Type this key in the app instead. | स्कैन नहीं हो रहा? यह key ऐप में लिख दें। |
| `twoFactor.copyKey` | Copy key | key कॉपी करें |
| `twoFactor.code` | 6-digit code | 6 अंकों का कोड |
| `twoFactor.submit` | Turn on two-factor | टू-फ़ैक्टर चालू करें |
| `twoFactor.verifying` | Checking | जांच हो रही है |
| `twoFactor.backupTitle` | Backup codes | बैकअप कोड |
| `twoFactor.backupBody` | Keep these somewhere safe. Each one works once if you lose your phone. | इन्हें संभाल कर रखें। फ़ोन खो जाए तो हर कोड एक बार काम करेगा। |
| `twoFactor.copyCodes` | Copy codes | कोड कॉपी करें |
| `twoFactor.continue` | I saved them, continue | सेव कर लिए, आगे बढ़ें |
| `company.title` | Company details | कंपनी की जानकारी |
| `company.body` | Tell us where your plant is and how to reach you. | बताएं कि आपका प्लांट कहां है और आपसे कैसे संपर्क करें। |
| `company.location` | Location | जगह |
| `company.locationHint` | Town or industrial area, like Pandesara, Surat. | शहर या इंडस्ट्रियल एरिया, जैसे पांडेसरा, सूरत। |
| `company.contact` | Contact phone | संपर्क फ़ोन |
| `company.timezone` | Time zone | टाइम ज़ोन |
| `company.thisDevice` | {zone} (this device) | {zone} (यह डिवाइस) |
| `company.presses` | Number of presses | प्रेस की संख्या |
| `company.pressesMax` | Up to {max} presses. | ज़्यादा से ज़्यादा {max} प्रेस। |
| `company.termsTitle` | The short version of the terms | शर्तें, छोटे में |
| `company.termsUse` | Use orrn for your company's work, in the role you were given. | orrn को अपनी कंपनी के काम के लिए, अपने दिए गए रोल में इस्तेमाल करें। |
| `company.termsPasswords` | Keep your password and authenticator to yourself. | अपना पासवर्ड और authenticator किसी से शेयर न करें। |
| `company.termsData` | Your company's data stays in your company, and every change is logged. | आपकी कंपनी का डेटा आपकी कंपनी में ही रहता है, और हर बदलाव का रिकॉर्ड रहता है। |
| `company.terms` | I agree to the orrn terms of service | मुझे orrn की सेवा शर्तें मंज़ूर हैं |
| `company.termsRequired` | Tick the box to agree before you continue. | आगे बढ़ने से पहले बॉक्स पर टिक करके मंज़ूरी दें। |
| `company.submit` | Save and continue | सेव करें और आगे बढ़ें |
| `company.submitting` | Saving | सेव हो रहा है |
| `done.title` | You're set up | सब तैयार है |
| `done.body` | Your account is ready. | आपका अकाउंट तैयार है। |
| `done.as` | You're in {company} as {role}. | आप {company} में {role} के रूप में हैं। |
| `done.joinedTitle` | Welcome to {company} | {company} में आपका स्वागत है |
| `done.joinedAs` | You're in as {role}. | आप {role} के रूप में जुड़ गए हैं। |
| `done.go` | Go to Today | आज का पेज खोलें |
| `done.goAdmin` | Open Godseye | Godseye खोलें |
| `done.goOther` | Continue | आगे बढ़ें |
| `done.opening` | Opening | खुल रहा है |

### today (128)

| Key | English | हिंदी |
|---|---|---|
| `title` | Today | आज |
| `greetingMorning` | Good morning, {name} | नमस्ते, {name} |
| `greetingAfternoon` | Good afternoon, {name} | नमस्ते, {name} |
| `greetingEvening` | Good evening, {name} | नमस्ते, {name} |
| `numbersHeading` | Today so far | आज अब तक |
| `shortcutsHeading` | Shortcuts | शॉर्टकट |
| `inStock` | In stock | स्टॉक में |
| `packed` | Packed today | आज पैक हुआ |
| `dispatched` | Dispatched today | आज dispatch हुआ |
| `dispatchesDone` | {count} {count:dispatch\|dispatches} done | {count} dispatch {count:हुआ\|हुए} |
| `noDispatchYet` | No dispatch done yet | अभी कोई dispatch नहीं हुआ |
| `bundleUnit` | {count:bundle\|bundles} | {count:bundle\|bundle} |
| `inStockKg` | {kg} kg | {kg} kg |
| `nothingPackedYet` | No bundles yet | अभी कोई bundle नहीं |
| `tiles.pack` | Pack | पैकिंग |
| `tiles.packHint` | Start a packing session | पैकिंग सेशन शुरू करें |
| `tiles.dispatch` | Dispatch | Dispatch |
| `tiles.dispatchHint` | {count} open | {count} {count:खुला\|खुले} |
| `tiles.dispatchHintNone` | None open | कोई खुला नहीं |
| `tiles.dispatchHintAny` | Load a truck | गाड़ी लोड करें |
| `tiles.stock` | Stock | स्टॉक |
| `tiles.stockHint` | Bundles by section | सेक्शन के हिसाब से bundle |
| `tiles.guides` | Guides | गाइड |
| `tiles.guidesHint` | How each job is done | हर काम कैसे करें |
| `openDispatches` | Open dispatches | खुले dispatch |
| `noOpenDispatches` | No open dispatches | कोई dispatch खुला नहीं है |
| `noOpenDispatchesBody` | Dispatches being built or held show up here. | जो dispatch बन रहे हैं या होल्ड पर हैं, वे यहां दिखेंगे। |
| `allDispatches` | All dispatches | सभी dispatch |
| `sessionsTodayHeading` | Packing sessions today | आज के पैकिंग सेशन |
| `noSessionsToday` | Nothing packed yet today | आज अभी कुछ पैक नहीं हुआ |
| `sessionVoided` | All bundles void | सारे bundle रद्द |
| `noSessionsTodayBody` | Each packing session shows up here as it is saved. | हर पैकिंग सेशन सेव होते ही यहां दिखेगा। |
| `allSessions` | All sessions | सभी सेशन |
| `printProblemsCount` | {count} {count:label\|labels} didn't print | {count} लेबल प्रिंट नहीं {count:हुआ\|हुए} |
| `printProblemsBody` | Check the printer, then print them again from Printing. | प्रिंटर देखें, फिर प्रिंटिंग से दोबारा प्रिंट करें। |
| `openPrinting` | Open printing | प्रिंटिंग खोलें |
| `loadErrorTitle` | Today's numbers didn't load | आज के आंकड़े लोड नहीं हुए |
| `loadErrorBody` | Check the connection and try again. | इंटरनेट देखें और फिर से कोशिश करें। |
| `refreshFailed` | Couldn't refresh. Showing the numbers from {time}. | रीफ़्रेश नहीं हुआ। {time} तक के आंकड़े दिख रहे हैं। |
| `chartsErrorTitle` | Charts didn't load | चार्ट लोड नहीं हुए |
| `chartsErrorBody` | Reload the page to load them again. | चार्ट फिर से लाने के लिए पेज दोबारा लोड करें। |
| `reloadPage` | Reload page | पेज दोबारा लोड करें |
| `trendsHeading` | Trends | रुझान |
| `trend.title` | Packed and dispatched | पैक और dispatch |
| `trend.subtitle` | kg per day, last 90 days, today so far | रोज़ का kg, पिछले 90 दिन, आज अब तक |
| `trend.label` | Packed and dispatched, kg per day | पैक और dispatch, रोज़ का kg |
| `trend.packed` | Packed | पैक हुआ |
| `trend.dispatched` | Dispatched | Dispatch हुआ |
| `trend.dateHeader` | Date | तारीख |
| `trend.emptyTitle` | Nothing packed or dispatched in 90 days | 90 दिन में कुछ पैक या dispatch नहीं हुआ |
| `trend.emptyBody` | Each day's kg shows up here once bundles are packed or dispatched. | Bundle पैक या dispatch होते ही हर दिन का kg यहां दिखेगा। |
| `ageing.title` | Stock age | स्टॉक की उम्र |
| `ageing.subtitle` | kg in stock by days since packing | पैकिंग से अब तक के दिनों के हिसाब से स्टॉक का kg |
| `ageing.label` | Stock age, kg by days since packing | स्टॉक की उम्र, पैकिंग से दिनों के हिसाब से kg |
| `ageing.ageHeader` | Age | उम्र |
| `ageing.valueHeader` | In stock | स्टॉक में |
| `ageing.upTo15` | 0-15 days | 0-15 दिन |
| `ageing.upTo15Short` | 0-15 | 0-15 |
| `ageing.upTo30` | 16-30 days | 16-30 दिन |
| `ageing.upTo30Short` | 16-30 | 16-30 |
| `ageing.upTo60` | 31-60 days | 31-60 दिन |
| `ageing.upTo60Short` | 31-60 | 31-60 |
| `ageing.over60` | Over 60 days | 60 दिन से ज़्यादा |
| `ageing.over60Short` | 60+ | 60+ |
| `ageing.emptyTitle` | Nothing in stock | स्टॉक में कुछ नहीं |
| `ageing.emptyBody` | Packed bundles show up here by how long they have been waiting. | पैक हुए bundle यहां दिखेंगे, कितने दिन से रखे हैं उसके हिसाब से। |
| `startHere.title` | Start here | यहां से शुरू करें |
| `startHere.body` | A few things to set up before the floor starts using orrn. | फ़्लोर पर orrn चलाने से पहले ये कुछ काम कर लें। |
| `startHere.bodyWaiting` | Your admin is setting orrn up. Today's numbers show here once the first bundles are packed. | एडमिन orrn सेट कर रहे हैं। पहले bundle पैक होते ही आज के आंकड़े यहां दिखेंगे। |
| `startHere.addDie` | Add a die | Die जोड़ें |
| `startHere.addCustomer` | Add a customer | ग्राहक जोड़ें |
| `startHere.packFirst` | Pack your first bundles | पहले bundle पैक करें |
| `startHere.connectPrinter` | Connect a label printer | लेबल प्रिंटर जोड़ें |
| `startHere.progress` | {done} of {total} done | {total} में से {done} हो गए |
| `startHere.done` | Done | हो गया |
| `startHere.askAdmin` | An admin sets this up | यह एडमिन सेट करेंगे |
| `startHere.afterDie` | After a die is added | Die जुड़ने के बाद |
| `shiftNow` | {shift} shift, {day} | {shift} शिफ्ट, {day} |
| `productionDay` | Production day {date}, from {time} | प्रोडक्शन का दिन {date}, {time} से |
| `productionDayMidnight` | Production day {date}, from midnight | प्रोडक्शन का दिन {date}, रात 12 बजे से |
| `calendarDate` | Calendar date {date} | कैलेंडर की तारीख {date} |
| `beforeStart` | Before {time} still counts for the day before. | {time} से पहले का समय पिछले दिन में गिना जाता है। |
| `clockNow` | Clock {time} | घड़ी {time} |
| `kpi.packed` | kg packed | पैक हुआ kg |
| `kpi.packedMeta` | This production day | प्रोडक्शन का यह दिन |
| `kpi.bundles` | Bundles | Bundle |
| `kpi.bundlesMeta` | Packed this production day | प्रोडक्शन के इस दिन पैक हुए |
| `kpi.dispatched` | kg dispatched | Dispatch हुआ kg |
| `kpi.dispatchedMeta` | Left stock this production day | प्रोडक्शन के इस दिन स्टॉक से गया |
| `kpi.stock` | In stock | स्टॉक में |
| `kpi.stockMeta` | {count} {count:bundle\|bundles} now | अभी {count} bundle |
| `kpi.value` | Dispatched value | Dispatch की कीमत |
| `kpi.valueMeta` | {count} {count:bundle\|bundles} with a rate | {count} bundle पर रेट है |
| `press.title` | Press | प्रेस |
| `press.open` | Open the press summary | प्रेस सारांश खोलें |
| `press.pressed` | Pressed today | आज प्रेस हुआ |
| `press.runs` | Runs: {count} | रन: {count} |
| `press.trials` | trials {kg} kg | ट्रायल {kg} kg |
| `press.recovery` | Recovery | रिकवरी |
| `press.recoveryMeta` | Production runs only | सिर्फ़ प्रोडक्शन रन |
| `press.downtime` | Downtime | रुकावट |
| `press.stops` | Stops, longest first | स्टॉपेज, सबसे लंबे पहले |
| `press.late` | Entered late | देर से भरे |
| `press.lateShare` | {pct}% of runs | {pct}% रन |
| `press.alertsOpen` | Press alerts open: {count} | प्रेस अलर्ट खुले: {count} |
| `press.alertsToday` | Press alerts today: {count} | आज के प्रेस अलर्ट: {count} |
| `press.alertsSimulated` | From the simulator | नकली डेटा से |
| `floor.heading` | Floor | फ़्लोर |
| `floor.press` | Press | प्रेस |
| `floor.pressHint` | {count} queued | {count} कतार में |
| `floor.dieRoom` | Die room | Die रूम |
| `floor.dieRoomHint` | {count} to issue | {count} देनी हैं |
| `floor.orders` | Orders | ऑर्डर |
| `floor.ordersHint` | {count} open | {count} {count:खुला\|खुले} |
| `floor.ageing` | Ageing | एजिंग |
| `floor.ageingHint` | {count} in the oven | {count} ओवन में |
| `floor.pressHintNone` | Nothing queued | कतार खाली है |
| `floor.pressHintAny` | Runs and queue | रन और कतार |
| `floor.dieRoomHintNone` | Nothing to issue | देने को कुछ नहीं |
| `floor.dieRoomHintAny` | Issue and take back | Die दें और वापस लें |
| `floor.ordersHintNone` | No open orders | कोई खुला ऑर्डर नहीं |
| `floor.ordersHintAny` | Order book | ऑर्डर बुक |
| `floor.approvals` | Approvals | मंज़ूरी |
| `floor.approvalsHint` | {count} waiting | {count} इंतज़ार में |
| `floor.approvalsHintNone` | Nothing waiting | कुछ इंतज़ार में नहीं |
| `floor.approvalsHintAny` | Requests waiting | इंतज़ार में अनुरोध |
| `floor.store` | Store | स्टोर |
| `floor.storeHint` | Chemicals, fuel and spares | केमिकल, ईंधन और स्पेयर |

### pack (208)

| Key | English | हिंदी |
|---|---|---|
| `title` | Pack | पैकिंग |
| `newSession` | New packing session | नया पैकिंग सेशन |
| `newSessionHint` | Choose the die, then enter each bundle's weight and pieces. | Die चुनें, फिर हर bundle का वज़न और पीस डालें। |
| `search` | Search session code or PO | सेशन कोड या PO से खोजें |
| `clearSearch` | Clear search | खोज हटाएं |
| `noMatch` | No sessions match "{query}". Check the code or PO. | "{query}" से कोई सेशन नहीं मिला। कोड या PO जांचें। |
| `listLabel` | Packing sessions | पैकिंग सेशन |
| `loadFailed` | Packing sessions didn't load. Check the connection and try again. | पैकिंग सेशन लोड नहीं हुए। कनेक्शन जांचें और फिर से कोशिश करें। |
| `whenToday` | Today, {time} | आज, {time} |
| `whenYesterday` | Yesterday, {time} | कल, {time} |
| `whenDate` | {date}, {time} | {date}, {time} |
| `unknownPacker` | Not known | पता नहीं |
| `draft.chip` | Not saved | सेव नहीं हुआ |
| `draft.body` | {count} {count:bundle\|bundles} entered in this tab and not saved yet. | इस टैब में डाले गए {count} bundle अभी सेव नहीं {count:हुआ\|हुए}। |
| `draft.resume` | Continue session | सेशन जारी रखें |
| `columns.session` | Session | सेशन |
| `columns.die` | Die | Die |
| `columns.section` | Section | सेक्शन |
| `columns.bundles` | Bundles | Bundle |
| `columns.kg` | kg | kg |
| `columns.packedBy` | Packed by | किसने पैक किया |
| `columns.when` | When | कब |
| `columns.po` | PO | PO |
| `empty` | No packing sessions yet. | अभी कोई पैकिंग सेशन नहीं है। |
| `emptyAction` | Start a packing session | पैकिंग सेशन शुरू करें |
| `new.title` | New packing session | नया पैकिंग सेशन |
| `new.steps.die` | Source | स्रोत |
| `new.steps.bundles` | Bundles | Bundle |
| `new.steps.review` | Review | जांचें |
| `new.dieSearch` | Search die code or section | Die कोड या सेक्शन से खोजें |
| `new.recentDies` | Recent | हाल के |
| `new.allDies` | All dies | सारे die |
| `new.diesShowing` | Showing {shown} of {total} dies. Type a code to find the rest. | {total} में से {shown} die दिख रहे हैं। बाकी के लिए कोड टाइप करें। |
| `new.dieRange` | Range {min} to {max} kg/12ft | रेंज {min} से {max} kg/12ft |
| `new.noDies` | No dies match. Check the code, or add the die first. | कोई die नहीं मिला। कोड जांचें, या पहले die जोड़ें। |
| `new.noDiesYet` | No dies yet. Add the die before packing. | अभी कोई die नहीं है। पैकिंग से पहले die जोड़ें। |
| `new.addDie` | Add a die | Die जोड़ें |
| `new.diesFailed` | Dies didn't load. Check the connection and try again. | Die लोड नहीं हुए। कनेक्शन जांचें और फिर से कोशिश करें। |
| `new.chooseDie` | Choose this die | यह die चुनें |
| `new.changeDie` | Change die | Die बदलें |
| `new.chosenDie` | Die | Die |
| `new.dieRequired` | Choose the die for this session. | इस सेशन का die चुनें। |
| `new.cutLength` | Cut length | कट लंबाई |
| `new.cutLengthFeet` | Feet | फ़ुट |
| `new.cutLengthInches` | Inches | इंच |
| `new.cutLengthMm` | Cut length (mm) | कट लंबाई (mm) |
| `new.cutLengthHintInch` | Feet and inches, for example 11 ft 6 in. | फ़ुट और इंच, जैसे 11 ft 6 in. |
| `new.cutLengthHintMm` | In millimetres, for example 3658. | मिलीमीटर में, जैसे 3658. |
| `new.cutLengthRequired` | Enter the cut length. | कट लंबाई डालें। |
| `new.yard` | Yard | यार्ड |
| `new.yardHint` | Where these bundles will be stacked. | ये bundle किस यार्ड में रखे जाएंगे। |
| `new.yardRequired` | Choose the yard these bundles go to. | ये bundle किस यार्ड में जाएंगे, वह चुनें। |
| `new.yardsFailed` | Yards didn't load. Check the connection and try again. | यार्ड लोड नहीं हुए। कनेक्शन जांचें और फिर से कोशिश करें। |
| `new.po` | PO | PO |
| `new.noPo` | No PO | PO नहीं |
| `new.poValue` | PO {po} | PO {po} |
| `new.change` | Change | बदलें |
| `new.defaultsHint` | Every bundle in this session uses this cut length and PO unless you change it on that bundle. | इस सेशन के हर bundle में यही कट लंबाई और PO लगेगा, जब तक आप उस bundle पर इसे न बदलें। |
| `new.weight` | Weight (kg) | वज़न (kg) |
| `new.pieces` | Pieces | पीस |
| `new.weightRequired` | Enter the weight in kg, for example 52.40. | वज़न kg में डालें, जैसे 52.40. |
| `new.piecesRequired` | Enter the pieces as a whole number. | पीस पूरे नंबर में डालें। |
| `new.saveBundle` | Save bundle | Bundle सेव करें |
| `new.differentLengthPo` | Different length or PO | अलग लंबाई या PO |
| `new.lengthForBundle` | Cut length for this bundle | इस bundle की कट लंबाई |
| `new.poForBundle` | PO for this bundle | इस bundle का PO |
| `new.editBundle` | Edit bundle | Bundle बदलें |
| `new.editBundleN` | Edit bundle {n} | Bundle {n} बदलें |
| `new.editingBundle` | Editing bundle {n} | Bundle {n} बदल रहे हैं |
| `new.removeBundle` | Remove bundle | Bundle हटाएं |
| `new.bundleNumber` | Bundle {n} | Bundle {n} |
| `new.liveIncomplete` | Enter weight and pieces to see kg/12ft. | kg/12ft देखने के लिए वज़न और पीस डालें। |
| `new.liveRange` | Die range {min} to {max} | Die रेंज {min} से {max} |
| `new.bundleSaved` | Bundle {n} saved: {kg} kg, {pieces} {pieces:piece\|pieces}, {status}. | Bundle {n} सेव हुआ: {kg} kg, {pieces} पीस, {status}। |
| `new.bundleUpdated` | Bundle {n} updated. | Bundle {n} बदल गया। |
| `new.bundleRemoved` | Bundle {n} removed. | Bundle {n} हट गया। |
| `new.savedBundles` | Bundles in this session | इस सेशन के bundle |
| `new.noBundlesYet` | No bundles yet. Enter the first bundle's weight and pieces. | अभी कोई bundle नहीं है। पहले bundle का वज़न और पीस डालें। |
| `new.maxReached` | This session has {max} bundles, the most one session can hold. Review and save it, then start another. | इस सेशन में {max} bundle हैं, एक सेशन में इससे ज़्यादा नहीं आ सकते। इसे जांचकर सेव करें, फिर नया सेशन शुरू करें। |
| `new.runningTotal` | Running total | अब तक का कुल |
| `new.review` | Review | जांचें |
| `new.totalBundles` | Bundles | Bundle |
| `new.totalPieces` | Pieces | पीस |
| `new.totalKg` | kg | kg |
| `new.outOfRange` | {count} {count:bundle is\|bundles are} outside the die's range. Check {count:it\|them} before saving. | {count} bundle die की रेंज से बाहर {count:है\|हैं}। सेव करने से पहले {count:इसे\|इन्हें} जांचें। |
| `new.backToBundles` | Back to bundles | Bundle पर वापस |
| `new.saveAndPrint` | Save and print labels | सेव करें और लेबल प्रिंट करें |
| `new.saveOnly` | Save session | सेशन सेव करें |
| `new.saved` | Session saved | सेशन सेव हो गया |
| `new.saveFailed` | The session didn't save. Your bundles are still here, so try again. | सेशन सेव नहीं हुआ। आपके bundle अभी भी यहां हैं, फिर से कोशिश करें। |
| `new.saveUnsure` | orrn didn't confirm the save. Tap Save again: the same bundles are never packed twice. | orrn से सेव का जवाब नहीं आया। फिर से सेव दबाएं: वही bundle दो बार पैक नहीं होंगे। |
| `new.openPack` | Open Pack | पैकिंग खोलें |
| `new.rangeUnknown` | Range not loaded | रेंज लोड नहीं हुई |
| `new.rangeFailed` | The die's range didn't load, so bundles can't be checked against it. | Die की रेंज लोड नहीं हुई, इसलिए bundle की जांच रेंज से नहीं हो सकती। |
| `new.printingProgress` | Printing {done} of {total} | प्रिंट: {total} में से {done} |
| `new.printFailed` | {count} {count:label\|labels} didn't print | {count} लेबल प्रिंट नहीं {count:हुआ\|हुए} |
| `new.retryFailed` | Retry failed labels | फ़ेल हुए लेबल फिर से प्रिंट करें |
| `new.draftKept` | Your unsaved bundles are still here. | आपके बिना सेव किए bundle अभी भी यहां हैं। |
| `new.discardDraft` | Discard unsaved bundles | बिना सेव किए bundle हटा दें |
| `new.discardTitle` | Discard unsaved bundles? | बिना सेव किए bundle हटा दें? |
| `new.discardBody` | The {count} {count:bundle\|bundles} you entered will be cleared. This can't be undone. | आपके डाले {count} bundle हट जाएंगे। यह वापस नहीं होगा। |
| `new.discard` | Discard | हटा दें |
| `new.forbidden` | Your role can't pack bundles. Ask an admin if you need it. | आपका रोल bundle पैक नहीं कर सकता। ज़रूरत हो तो एडमिन से कहें। |
| `new.liveBand` | Band {band} | बैंड {band} |
| `new.liveBandCopy` | Copy band {band} | कॉपी का बैंड {band} |
| `new.drift` | Drift {percent} | ड्रिफ्ट {percent} |
| `new.driftBasis` | against the band start | बैंड की शुरुआत से |
| `new.saveCast` | Pick the cast these bundles came from, then save again. | जिस कास्ट से ये bundle बने वह चुनें, फिर से सेव करें। |
| `new.saveCopy` | Pick the die copy, then save again. | Die की कॉपी चुनें, फिर से सेव करें। |
| `new.saveReason` | A typed weight needs a reason while the scale is connected. Add it on the bundle. | कांटा जुड़ा होने पर हाथ से डाले वज़न का कारण चाहिए। उसे bundle पर लिखें। |
| `new.saveScale` | The scale is not connected now. Type the weights and say why. | अभी कांटा जुड़ा नहीं है। वज़न हाथ से डालें और कारण लिखें। |
| `new.saveOrder` | That order is closed or is for another section. Pick the order again. | वह ऑर्डर बंद है या दूसरे सेक्शन का है। ऑर्डर फिर से चुनें। |
| `detail.title` | Session {code} | सेशन {code} |
| `detail.packedBy` | Packed by {name} | {name} ने पैक किया |
| `detail.printAll` | Print all labels | सारे लेबल प्रिंट करें |
| `detail.reprint` | Reprint | फिर से प्रिंट करें |
| `detail.reprintSerial` | Reprint label for {serial} | {serial} का लेबल फिर से प्रिंट करें |
| `detail.labelsSent` | Labels sent to printer | लेबल प्रिंटर को भेज दिए |
| `detail.labelSent` | Label sent to printer | लेबल प्रिंटर को भेज दिया |
| `detail.viewBundle` | Open bundle {serial} | Bundle {serial} खोलें |
| `detail.facts` | Session details | सेशन की जानकारी |
| `detail.unit` | Length unit | लंबाई की इकाई |
| `detail.unitInch` | Feet and inches | फ़ुट और इंच |
| `detail.unitMm` | Millimetres | मिलीमीटर |
| `detail.packedAt` | Packed | पैक हुआ |
| `detail.mixed` | Mixed | अलग-अलग |
| `detail.rangeColumn` | Die range | Die रेंज |
| `detail.outsideRange` | {count} outside range | {count} रेंज से बाहर |
| `detail.bundlesTitle` | Bundles | Bundle |
| `detail.loadFailed` | This session didn't load. Check the connection and try again. | यह सेशन लोड नहीं हुआ। कनेक्शन जांचें और फिर से कोशिश करें। |
| `detail.notFound` | No packing session at this link. Open it from the Pack list. | इस लिंक पर कोई पैकिंग सेशन नहीं है। पैकिंग सेशन की सूची से खोलें। |
| `print.title` | Labels | लेबल |
| `print.allSent` | {count} {count:label\|labels} sent to printer | {count} लेबल प्रिंटर को भेज {count:दिया\|दिए} |
| `print.errors.notSetUp` | Label printing isn't set up for your company. | आपकी कंपनी के लिए लेबल प्रिंटिंग सेट नहीं है। |
| `print.errors.noPrinter` | No label printer is set up for bundles. Ask a manager. | Bundle के लिए कोई लेबल प्रिंटर सेट नहीं है। मैनेजर से कहें। |
| `print.errors.noTemplate` | The bundle label isn't ready on the printer yet. Ask a manager. | Bundle का लेबल अभी प्रिंटर पर तैयार नहीं है। मैनेजर से कहें। |
| `print.errors.offline` | The printer didn't take the label. Check it is on and connected. | प्रिंटर ने लेबल नहीं लिया। जांचें कि प्रिंटर चालू है और जुड़ा है। |
| `print.errors.forbidden` | Your role can't print labels. | आपका रोल लेबल प्रिंट नहीं कर सकता। |
| `print.errors.network` | No internet connection. Check it and try again. | इंटरनेट नहीं है। कनेक्शन जांचें और फिर से कोशिश करें। |
| `print.errors.generic` | The label didn't print. Try again, or reprint it from the bundle's row. | लेबल प्रिंट नहीं हुआ। फिर से कोशिश करें, या bundle की लाइन से दोबारा प्रिंट करें। |
| `print.noPrinterTitle` | No label printer is connected | कोई लेबल प्रिंटर जुड़ा नहीं है |
| `print.noPrinterBody` | Print the labels on A4 stickers from this browser instead. Same QR, same figures. | इसी ब्राउज़र से A4 स्टिकर पर लेबल प्रिंट करें। वही QR, वही आंकड़े। |
| `print.sheet` | Print label sheet | लेबल शीट प्रिंट करें |
| `partyNo` | Party no. | पार्टी नंबर |
| `forOrder` | For order | किस ऑर्डर के लिए |
| `plantStock` | Plant stock | प्लांट स्टॉक |
| `ageingRow` | From ageing | एजिंग से |
| `recut` | Cut shorter | छोटा काटा |
| `standard` | Standard | स्टैंडर्ड |
| `showLogo` | Print logo | लोगो प्रिंट करें |
| `dieOwned` | This die belongs to {name} | यह die {name} की है |
| `scale.title` | Scale | कांटा |
| `scale.stable` | Steady | स्थिर |
| `scale.waiting` | Waiting for a steady weight | स्थिर वज़न का इंतज़ार |
| `scale.stale` | The scale stopped sending | कांटे से वज़न नहीं आ रहा |
| `scale.useScale` | Use scale weight | कांटे का वज़न लें |
| `scale.typed` | Typed | हाथ से लिखा |
| `scale.typedReason` | Why type the weight | वज़न हाथ से क्यों लिखा |
| `scale.fromScale` | From the scale | कांटे से |
| `scale.reasonRequired` | Say why you typed the weight. | वज़न हाथ से क्यों डाला, यह लिखें। |
| `scale.simulated` | (simulated) | (नकली) |
| `scale.typedCount` | {count} {count:bundle was\|bundles were} typed, not weighed. The reasons are saved. | {count} bundle का वज़न हाथ से डाला गया, तौला नहीं गया। कारण सेव हैं। |
| `scale.typedReasonHint` | For example: the scale was off, or the bundle was weighed elsewhere. | जैसे: कांटा बंद था, या bundle कहीं और तौला गया। |
| `reject.title` | Rejects | रिजेक्ट |
| `reject.add` | Add reject | रिजेक्ट जोड़ें |
| `reject.pcs` | Pieces | पीस |
| `reject.kg` | kg | kg |
| `reject.saved` | {count} {count:piece\|pieces} rejected | {count} पीस रिजेक्ट |
| `reject.hint` | Reject pieces leave the pile and are not a bundle. Kg, if you enter it, posts at plant scrap. | रिजेक्ट पीस ढेर से हट जाते हैं और bundle नहीं होते। kg डालें तो वह प्लांट स्क्रैप में जाता है। |
| `reject.kgHint` | Leave blank if the pieces were not weighed. | पीस तौले नहीं गए हों तो खाली छोड़ें। |
| `reject.reason` | Reason | कारण |
| `reject.pickReason` | Pick a reason | कारण चुनें |
| `reject.reasonRequired` | Pick why they were rejected. | रिजेक्ट का कारण चुनें। |
| `reject.addLine` | Save reject | रिजेक्ट सेव करें |
| `reject.remove` | Remove reject {n} | रिजेक्ट {n} हटाएं |
| `reject.added` | Reject added: {count} {count:piece\|pieces} | रिजेक्ट जुड़ा: {count} पीस |
| `reject.atScrap` | {kg} kg at plant scrap | प्लांट स्क्रैप में {kg} kg |
| `reject.noWeight` | no weight, so no kg row | वज़न नहीं, इसलिए kg की एंट्री नहीं |
| `reject.unit` | pcs rejected | पीस रिजेक्ट |
| `reject.piecesLabel` | Reject pieces | रिजेक्ट पीस |
| `dieOwnedOther` | This die belongs to another customer | यह die किसी दूसरे ग्राहक की है |
| `partyNo1` | Party number {number} | पार्टी नंबर {number} |
| `partyNos` | Party numbers {from} to {to} | पार्टी नंबर {from} से {to} |
| `source.title` | Source | स्रोत |
| `source.hand` | No trolley | ट्रॉली नहीं |
| `source.handHint` | Packing by hand. Trolley rows come with ageing. | हाथ से पैकिंग। ट्रॉली की पंक्तियां एजिंग के साथ आएंगी। |
| `source.forOrderHint` | Packing does not change baki. Dispatch does. | पैकिंग से बाकी नहीं बदलता। डिस्पैच से बदलता है। |
| `source.plantStock` | Plant stock | प्लांट स्टॉक |
| `source.plantStockHint` | Packed for no order. The office can send them on any customer's load. | किसी ऑर्डर के लिए नहीं। ऑफिस इन्हें किसी भी ग्राहक के लोड पर भेज सकता है। |
| `source.pinned` | This line is for die copy {code}. | यह लाइन die कॉपी {code} के लिए है। |
| `source.pinnedOverride` | Office: pack on another copy | ऑफिस: दूसरी कॉपी पर पैक करें |
| `source.suggested` | Suggested | सुझाया गया |
| `source.lineDetail` | {baki} kg baki of {ordered} kg ordered | {ordered} kg ऑर्डर में से {baki} kg बाकी |
| `source.copy` | Die copy | Die कॉपी |
| `source.copyHint` | The copy that made these bundles. Its band judges the weight. | जिस कॉपी से ये bundle बने। वज़न उसी के बैंड से जांचा जाएगा। |
| `source.noCopy` | No copy named | कॉपी नहीं चुनी |
| `source.noCopyHint` | The section's main band judges the weight. | वज़न सेक्शन के मुख्य बैंड से जांचा जाएगा। |
| `source.copyRequired` | Pick the die copy. This die belongs to a customer. | Die की कॉपी चुनें। यह die किसी ग्राहक की है। |
| `source.latest` | Latest {kg} | ताज़ा {kg} |
| `source.cast` | Cast | कास्ट |
| `source.castHint` | The cast these billets came from. It prints on the label. | जिस कास्ट के billet से ये बने। यह लेबल पर छपता है। |
| `source.castRequiredHint` | Your plant asks for the cast on every bundle. | आपका प्लांट हर bundle पर कास्ट मांगता है। |
| `source.castRequired` | Pick the cast. | कास्ट चुनें। |
| `source.noCast` | No cast | कास्ट नहीं |
| `source.noCopies` | This die belongs to a customer and has no copies yet. Ask the die room. | यह die किसी ग्राहक की है और इसकी अभी कोई कॉपी नहीं है। Die रूम से कहें। |
| `source.ownedHint` | It can only be packed for that customer's order. | इसे सिर्फ उसी ग्राहक के ऑर्डर के लिए पैक किया जा सकता है। |
| `source.logoHint` | Off hides the logo on the label. The company name still prints. | बंद करने पर लेबल से लोगो हट जाता है। कंपनी का नाम फिर भी छपता है। |
| `source.cannotContinue` | Fix the points above before you go on. | आगे जाने से पहले ऊपर की बातें ठीक करें। |

### scan (60)

| Key | English | हिंदी |
|---|---|---|
| `title` | Scan | स्कैन |
| `manualLabel` | Serial or label link | Serial या लेबल लिंक |
| `manualHint` | Type it or use a barcode scanner, then press Enter. | लिखें या बारकोड स्कैनर से स्कैन करें, फिर Enter दबाएं। |
| `find` | Find | खोजें |
| `pointAtLabel` | Point the camera at the bundle label | कैमरा bundle के लेबल की तरफ़ रखें |
| `cameraTitle` | Use the camera to scan | स्कैन के लिए कैमरा चालू करें |
| `cameraBody` | orrn uses the camera only to read bundle labels. | orrn कैमरे से सिर्फ़ bundle के लेबल पढ़ता है। |
| `allowCamera` | Turn on camera | कैमरा चालू करें |
| `cameraBlocked` | The camera is blocked. Allow it in your browser or phone settings, or type the serial below. | कैमरा बंद है। ब्राउज़र या फ़ोन की सेटिंग में इसे चालू करें, या नीचे serial लिखें। |
| `noCamera` | No camera found. Type the serial below. | कैमरा नहीं मिला। नीचे serial लिखें। |
| `cameraStarting` | Starting the camera | कैमरा चालू हो रहा है |
| `cameraFailed` | The camera didn't start. Type the serial below, or try again. | कैमरा चालू नहीं हुआ। नीचे serial लिखें, या फिर से कोशिश करें। |
| `cameraOff` | Turn off camera | कैमरा बंद करें |
| `ambiguous` | More than one bundle has this number. Pick the right one. | इस नंबर के एक से ज़्यादा bundle हैं। सही वाला चुनें। |
| `madeIn` | Made in {year} | {year} में बना |
| `recent` | Recent scans | हाल के स्कैन |
| `torchOn` | Turn torch on | टॉर्च चालू करें |
| `torchOff` | Turn torch off | टॉर्च बंद करें |
| `notFound` | Not found in this company | इस कंपनी में नहीं मिला |
| `unrecognised` | That isn't a bundle serial or label link. Check it and try again. | यह bundle का serial या लेबल लिंक नहीं है। देखकर फिर से कोशिश करें। |
| `continuous.offBand` | {kg} kg/12ft, {order} says {line}. Check the weight. | {kg} kg/12ft, {order} में {line}। वज़न जांचें। |
| `continuous.outsideOrder` | This packing list is for {order} only | यह packing list सिर्फ़ {order} की है |
| `continuous.outsideOrderPlain` | This packing list is for one sales order only | यह packing list सिर्फ़ एक sales order की है |
| `continuous.orderBaki` | {order}: baki {baki} kg, {left} kg left after this load | {order}: बाकी {baki} kg, इस लोड के बाद {left} kg बचा |
| `continuous.orderOver` | {kg} kg over the baki. | बाकी से {kg} kg ज़्यादा। |
| `continuous.title` | Scanning into {code} | {code} में स्कैन हो रहा है |
| `continuous.added` | Added {serial} | {serial} जुड़ गया |
| `continuous.count` | {count} added | {count} {count:जुड़ा\|जुड़े} |
| `continuous.already` | Already in this dispatch | इस dispatch में पहले से है |
| `continuous.heldElsewhere` | Held for another dispatch | किसी दूसरे dispatch के लिए होल्ड पर है |
| `continuous.reallocationPending` | Waiting on a reallocation approval | reallocation की मंज़ूरी बाकी है |
| `continuous.void` | This bundle is void | यह bundle रद्द है |
| `continuous.dispatched` | Already dispatched | पहले ही dispatch हो चुका है |
| `continuous.wrongStatus` | Can't add a bundle that is {status} | "{status}" वाला bundle नहीं जोड़ सकते |
| `continuous.heldBy` | Held for {code} | {code} के लिए होल्ड पर है |
| `continuous.adding` | Adding {serial} | {serial} जोड़ रहे हैं |
| `continuous.closed` | This dispatch can't take more bundles now. | इस dispatch में अब और bundle नहीं जुड़ सकते। |
| `continuous.empty` | Scan a bundle label to add it. | जोड़ने के लिए bundle का लेबल स्कैन करें। |
| `continuous.result.added` | Added | जुड़ा |
| `continuous.result.already` | Already added | पहले से जुड़ा |
| `continuous.result.rejected` | Not added | नहीं जुड़ा |
| `continuous.result.notFound` | Not found | नहीं मिला |
| `continuous.done` | Done scanning | स्कैन बंद करें |
| `continuous.dieOwned` | Die belongs to {name} | Die {name} की है |
| `continuous.otherOrder` | On another customer's order | दूसरे ग्राहक के ऑर्डर पर |
| `continuous.overCapacity` | {kg} kg over the truck's capacity | गाड़ी की क्षमता से {kg} kg ज़्यादा |
| `continuous.unassigned` | Not on a sales order | किसी सेल्स ऑर्डर पर नहीं |
| `continuous.wrongCustomer` | Packed for {name} | {name} के लिए पैक हुआ |
| `continuous.wrongCustomerOther` | Packed for another customer | किसी दूसरे ग्राहक के लिए पैक हुआ |
| `continuous.dieOwnedOther` | This die belongs to another customer | यह die किसी दूसरे ग्राहक की है |
| `continuous.ambiguous` | More than one bundle has this number: {numbers} | इस नंबर के कई bundle हैं: {numbers} |
| `continuous.ambiguousPlain` | More than one bundle has this number. Scan its label. | इस नंबर के कई bundle हैं। उसका लेबल स्कैन करें। |
| `continuous.addAnyway` | Add anyway (not on a sales order) | फिर भी जोड़ें (सेल्स ऑर्डर पर नहीं) |
| `continuous.addAnywayHint` | Office only. The bundle goes on this load with no order line. | सिर्फ ऑफिस के लिए। bundle बिना ऑर्डर लाइन के इस लोड में जाएगा। |
| `continuous.addedNoOrder` | Added {serial}, no order | {serial} जुड़ा, ऑर्डर नहीं |
| `continuous.noOrderTag` | No order | ऑर्डर नहीं |
| `continuous.pickOne` | Pick the bundle | Bundle चुनें |
| `continuous.speak` | Speak refusals aloud | मना करने की वजह बोलकर बताएं |
| `continuous.heldForOrder` | Held for {order} ({customer}) | {order} ({customer}) के लिए होल्ड पर है |
| `continuous.heldForOrderPlain` | Held for a sales order | एक sales order के लिए होल्ड पर है |

### stock (174)

| Key | English | हिंदी |
|---|---|---|
| `title` | Stock | स्टॉक |
| `sections` | Sections | सेक्शन |
| `bundles` | Bundles | Bundle |
| `searchSections` | Search die or section | Die या सेक्शन खोजें |
| `totals` | {bundles} {bundles:bundle\|bundles} · {kg} kg in stock | स्टॉक में {bundles} bundle · {kg} kg |
| `listed` | {bundles} {bundles:bundle\|bundles} · {kg} kg listed | लिस्ट में {bundles} bundle · {kg} kg |
| `heldChip` | {count} held | {count} होल्ड पर |
| `heldKg` | {count} held, {kg} kg | {count} होल्ड पर, {kg} kg |
| `empty` | No stock yet. Bundles show up here after packing. | अभी स्टॉक नहीं है। पैकिंग के बाद bundle यहां दिखेंगे। |
| `emptyAction` | Start a packing session | पैकिंग सेशन शुरू करें |
| `view` | Stock view | स्टॉक व्यू |
| `filterStatus` | Status | स्टेटस |
| `clearSearch` | Clear search | खोज हटाएं |
| `sectionsFound` | {count} {count:section\|sections} found | {count} सेक्शन {count:मिला\|मिले} |
| `loadError` | Stock didn't load. Check the connection, then try again. | स्टॉक लोड नहीं हुआ। इंटरनेट देखें, फिर दोबारा कोशिश करें। |
| `noPermission` | Your role can't do this. Ask your admin. | आपके रोल को यह करने की अनुमति नहीं है। अपने एडमिन से पूछें। |
| `reprintSent` | Label sent to printer | लेबल प्रिंटर को भेजा |
| `reprintNoPrinter` | No label printer is set up. Ask your admin to connect one in Printing. | कोई लेबल प्रिंटर सेट नहीं है। एडमिन से Printing में प्रिंटर जोड़ने को कहें। |
| `reprintFailed` | The label didn't print. Check that the print station is on, then try again. | लेबल प्रिंट नहीं हुआ। देखें कि प्रिंट स्टेशन चालू है, फिर दोबारा कोशिश करें। |
| `block.unitInStock` | {count:bundle\|bundles} in stock | {count:bundle\|bundle} स्टॉक में |
| `block.unitHeld` | {count:bundle\|bundles} held | {count:bundle\|bundle} होल्ड पर |
| `block.band` | {band} kg/12ft | {band} kg/12ft |
| `block.kg` | {kg} kg | {kg} kg |
| `charts.ageTitle` | Stock age | स्टॉक कितना पुराना |
| `charts.ageSubtitle` | kg on the floor, in stock and held, by days since packing | फ़्लोर पर kg, स्टॉक और होल्ड, पैकिंग के बाद के दिनों के हिसाब से |
| `charts.ageLabel` | Stock age, kg by days since packing | स्टॉक की उम्र, पैकिंग के बाद के दिनों के हिसाब से kg |
| `charts.ageHeader` | Age | उम्र |
| `charts.kgHeader` | kg | kg |
| `charts.bucket` | {range} days | {range} दिन |
| `charts.topTitle` | Top sections | सबसे ज़्यादा स्टॉक वाले सेक्शन |
| `charts.topSubtitle` | kg in stock and held per section, top 8 and the rest | हर सेक्शन का स्टॉक और होल्ड का kg, टॉप 8 और बाकी |
| `charts.topLabel` | Sections by kg on the floor | फ़्लोर पर kg के हिसाब से सेक्शन |
| `charts.otherSections` | Other sections | बाकी सेक्शन |
| `charts.loadFailed` | Charts didn't load. Check the connection, then try again. | चार्ट लोड नहीं हुए। इंटरनेट देखें, फिर दोबारा कोशिश करें। |
| `section.title` | Section {code} | सेक्शन {code} |
| `section.empty` | No bundles with this status. | इस स्टेटस का कोई bundle नहीं है। |
| `section.emptyAll` | No bundles packed for this section yet. | इस सेक्शन का अभी कोई bundle पैक नहीं हुआ। |
| `section.nothingOnFloor` | Nothing on the floor | फ़्लोर पर कुछ नहीं |
| `section.heroUnit` | {count:bundle\|bundles} | {count:bundle\|bundle} |
| `section.band` | Weight range {band} kg/12ft | वज़न रेंज {band} kg/12ft |
| `section.dieDetails` | Die details | Die की जानकारी |
| `section.bundlesLabel` | Bundles of {section} | {section} के bundle |
| `list.title` | All bundles | सारे bundle |
| `list.search` | Search serial or PO | Serial या PO खोजें |
| `list.empty` | No bundles match this filter. | इस फ़िल्टर में कोई bundle नहीं है। |
| `list.bundlesLabel` | Bundles | Bundle |
| `list.filterDie` | Showing one section | एक सेक्शन दिख रहा है |
| `list.filterGroup` | Showing one packing session | एक पैकिंग सेशन दिख रहा है |
| `list.filterDieNamed` | Showing {section} | {section} दिख रहा है |
| `list.filterGroupNamed` | Showing packing session {code} | पैकिंग सेशन {code} दिख रहा है |
| `list.clearFilter` | Show all bundles | सारे bundle दिखाएं |
| `columns.serial` | Serial | Serial |
| `columns.die` | Die | Die |
| `columns.section` | Section | सेक्शन |
| `columns.weight` | Weight (kg) | वज़न (kg) |
| `columns.pieces` | Pcs | पीस |
| `columns.cutLength` | Cut length | कट लंबाई |
| `columns.piecesLength` | Pcs × cut length | पीस × कट लंबाई |
| `columns.kgPer12ft` | kg/12ft | kg/12ft |
| `columns.status` | Status | स्टेटस |
| `columns.po` | PO | PO |
| `columns.packed` | Packed | पैक हुआ |
| `columns.yard` | Yard | यार्ड |
| `columns.order` | Order | ऑर्डर |
| `columns.held` | Held | होल्ड |
| `columns.oldest` | Oldest | सबसे पुराना |
| `lengths` | Lengths | लंबाई |
| `yards` | Yards | यार्ड |
| `lengthsLabel` | Stock by section and cut length | सेक्शन और कट लंबाई के हिसाब से स्टॉक |
| `lengthsEmpty` | No stock matches these filters. | इन फ़िल्टर से कोई स्टॉक नहीं मिला। |
| `yardsEmpty` | No yards to show. Yards are set up in Masters. | दिखाने के लिए कोई यार्ड नहीं। यार्ड मास्टर्स में बनते हैं। |
| `noYard` | No yard | यार्ड नहीं |
| `yardEmpty` | Empty | खाली |
| `yardLine` | {bundles} {bundles:bundle\|bundles} · {sections} {sections:section\|sections} | {bundles} bundle · {sections} सेक्शन |
| `yardTop` | Biggest sections in this yard | इस यार्ड के सबसे बड़े सेक्शन |
| `filters.title` | Filters | फ़िल्टर |
| `filters.titleCount` | Filters ({count}) | फ़िल्टर ({count}) |
| `filters.clear` | Clear filters | फ़िल्टर हटाएं |
| `filters.yard` | Yard | यार्ड |
| `filters.allYards` | All yards | सारे यार्ड |
| `filters.customer` | Customer | ग्राहक |
| `filters.anyCustomer` | Any customer | कोई भी ग्राहक |
| `filters.order` | Sales order | सेल्स ऑर्डर |
| `filters.anyOrder` | Any order of this customer | इस ग्राहक का कोई भी ऑर्डर |
| `filters.section` | Section | सेक्शन |
| `filters.sectionSearch` | Search section code | सेक्शन कोड खोजें |
| `filters.anySection` | Any section | कोई भी सेक्शन |
| `filters.kind` | Profile | प्रोफाइल |
| `filters.plant` | Plant stock only | सिर्फ प्लांट स्टॉक |
| `filters.from` | Packed from | पैक होने की शुरुआत |
| `filters.to` | Packed to | पैक होने की आखिरी तारीख |
| `count.title` | Stock count | स्टॉक की गिनती |
| `count.open` | Stock count | स्टॉक की गिनती |
| `count.subtitle` | Walk the yards, scan every bundle, and see what is missing. | यार्ड में घूमें, हर bundle स्कैन करें, और देखें क्या कम है। |
| `count.start` | Start a count | गिनती शुरू करें |
| `count.startTitle` | Start a count | गिनती शुरू करें |
| `count.yardsLegend` | Yards to count | गिनने के यार्ड |
| `count.everyYardHint` | Every yard is counted, so bundles with no yard are expected too. | सारे यार्ड गिने जाएंगे, इसलिए बिना यार्ड वाले bundle भी गिनती में माने जाएंगे। |
| `count.someYardsHint` | Only these yards are counted. Bundles with no yard are left out. | सिर्फ ये यार्ड गिने जाएंगे। बिना यार्ड वाले bundle छोड़ दिए जाते हैं। |
| `count.noYards` | No yards are set up yet. | अभी कोई यार्ड नहीं बना है। |
| `count.pickYards` | Pick the yards to count. | गिनने के यार्ड चुनें। |
| `count.yardBusy` | One of these yards is already being counted. Open that count, or pick another yard. | इनमें से एक यार्ड की गिनती पहले से चल रही है। वह गिनती खोलें, या दूसरा यार्ड चुनें। |
| `count.started` | {number} started | {number} शुरू हुई |
| `count.openCounts` | Counts in progress | चल रही गिनतियां |
| `count.noneOpen` | No count is in progress. | कोई गिनती नहीं चल रही। |
| `count.pastCounts` | Earlier counts | पिछली गिनतियां |
| `count.phantomTitle` | Missing bundles | गायब bundle |
| `count.phantomOpen` | Still missing from closed counts | बंद गिनतियों से अब भी गायब |
| `count.lastCount` | Last count {number} | पिछली गिनती {number} |
| `count.lastShare` | {share} missing, {phantom} of {expected} | {share} गायब, {expected} में से {phantom} |
| `count.status.open` | Open | चालू |
| `count.status.closed` | Closed | बंद |
| `count.status.cancelled` | Cancelled | रद्द |
| `count.rowClosed` | {phantom} missing, {found} found, {expected} expected | {phantom} गायब, {found} मिले, {expected} होने चाहिए थे |
| `count.rowOpen` | {seen} scanned so far | अब तक {seen} स्कैन |
| `count.startedBy` | Started {when} by {name} | {when} को {name} ने शुरू की |
| `count.closedAt` | closed {when} | {when} को बंद |
| `count.cancelReasonLine` | cancelled: {reason} | रद्द: {reason} |
| `count.expected` | Expected | होने चाहिए |
| `count.seen` | Scanned | स्कैन हुए |
| `count.counted` | Counted | गिने गए |
| `count.phantom` | Missing | गायब |
| `count.found` | Found | मिले |
| `count.moved` | Moved | खिसके हुए |
| `count.phantomShare` | Missing share | गायब का हिस्सा |
| `count.variance` | Difference | फ़र्क |
| `count.scanTitle` | Scan the yard | यार्ड स्कैन करें |
| `count.yardNow` | Yard you are in | आप जिस यार्ड में हैं |
| `count.pickYard` | Pick the yard you are in first. | पहले वह यार्ड चुनें जिसमें आप हैं। |
| `count.scanLabel` | Scan a bundle or type its number | Bundle स्कैन करें या उसका नंबर लिखें |
| `count.paste` | Paste codes | कोड पेस्ट करें |
| `count.pasteLabel` | Codes | कोड |
| `count.pasteHint` | One per line or separated by commas. Serials, party numbers and old numbers all work. | हर लाइन में एक, या कॉमा से अलग। सीरियल, पार्टी नंबर और पुराने नंबर सब चलते हैं। |
| `count.pasteSend` | Count {count} {count:code\|codes} | {count} कोड गिनें |
| `count.feed` | What the scans found | स्कैन से क्या मिला |
| `count.duplicate` | scanned before | पहले स्कैन हुआ |
| `count.scanTotal` | {count} {count:scan\|scans} in this count | इस गिनती में {count} स्कैन |
| `count.scanFailed` | That didn't reach the count. Check the connection and scan again. | वह गिनती तक नहीं पहुंचा। कनेक्शन जांचें और फिर स्कैन करें। |
| `count.match.here` | Here | यहीं है |
| `count.match.moved` | Moved | खिसका हुआ |
| `count.match.elsewhere` | Elsewhere | कहीं और |
| `count.match.not_in_stock` | Not in stock | स्टॉक में नहीं |
| `count.match.unknown` | Unknown code | पहचाना नहीं गया |
| `count.match.ambiguous` | Several bundles | कई bundle |
| `count.close` | Close count | गिनती बंद करें |
| `count.closeTitle` | Close {number}? | {number} बंद करें? |
| `count.closeBody` | Closing freezes the report. {count} {count:bundle is\|bundles are} missing so far. The stock is not changed. | बंद करने पर रिपोर्ट पक्की हो जाती है। अब तक {count} bundle गायब {count:है\|हैं}। स्टॉक नहीं बदलता। |
| `count.closeAnyway` | Close anyway | फिर भी बंद करें |
| `count.unscannedWarn` | A yard in this count has no scan at all, so closing reports all its bundles missing. Scan it, or close anyway. | इस गिनती के एक यार्ड में कोई स्कैन नहीं हुआ, इसलिए बंद करने पर उसके सारे bundle गायब गिने जाएंगे। उसे स्कैन करें, या फिर भी बंद करें। |
| `count.closed` | {number} closed | {number} बंद हुई |
| `count.cancel` | Cancel count | गिनती रद्द करें |
| `count.cancelTitle` | Cancel {number}? | {number} रद्द करें? |
| `count.cancelBody` | The scans are kept out of any report and the yards can be counted again. | स्कैन किसी रिपोर्ट में नहीं जाएंगे और यार्ड फिर से गिने जा सकेंगे। |
| `count.cancelReason` | Why cancel it | रद्द क्यों कर रहे हैं |
| `count.cancelReasonRequired` | Say why the count is cancelled. | गिनती रद्द करने का कारण लिखें। |
| `count.cancelled` | {number} cancelled | {number} रद्द हुई |
| `count.byYard` | By yard | यार्ड के हिसाब से |
| `count.bySection` | By section | सेक्शन के हिसाब से |
| `count.unknownCodes` | Unknown codes | अनजान कोड |
| `count.phantomReport` | Missing bundles | गायब bundle |
| `count.missingNow` | Missing so far | अब तक गायब |
| `count.askVoid` | Ask to void {count} missing | {count} गायब को void करने को कहें |
| `count.voidAsked` | A manager is asked to void them. | मैनेजर से void करने को कहा गया। |
| `count.moveFound` | Move {count} to where they were seen | {count} को वहां ले जाएं जहां दिखे |
| `count.movedDone` | Moved to where they were seen. | जहां दिखे वहां ले जाए गए। |
| `count.resolution.void_requested` | Void asked | void मांगा गया |
| `count.resolution.voided` | Voided | void हुआ |
| `count.resolution.moved` | Moved | ले जाया गया |
| `count.resolution.cleared` | Cleared | साफ़ हुआ |
| `count.foundReason.unknown` | Unknown code | पहचाना नहीं गया |
| `count.foundReason.ambiguous` | Several bundles | कई bundle |
| `count.foundReason.not_in_stock` | Not in stock | स्टॉक में नहीं |
| `count.foundReason.elsewhere` | Other yard | दूसरा यार्ड |
| `count.notFound` | This count wasn't found. | यह गिनती नहीं मिली। |

### bundle (60)

| Key | English | हिंदी |
|---|---|---|
| `title` | Bundle {serial} | Bundle {serial} |
| `facts.weight` | Weight | वज़न |
| `facts.pieces` | Pieces | पीस |
| `facts.cutLength` | Cut length | कट लंबाई |
| `facts.kgPer12ft` | kg/12ft | kg/12ft |
| `facts.weightRange` | Weight range /12' | वज़न रेंज /12' |
| `facts.die` | Die | Die |
| `facts.section` | Section | सेक्शन |
| `facts.po` | PO | PO |
| `facts.session` | Packing session | पैकिंग सेशन |
| `facts.dieBand` | Die range /12' | Die रेंज /12' |
| `facts.packed` | Packed | पैक हुआ |
| `facts.copyBand` | Copy band /12' | कॉपी का बैंड /12' |
| `facts.location` | Yard | यार्ड |
| `facts.noLocation` | No yard recorded | यार्ड दर्ज नहीं |
| `facts.packedFor` | Packed for | किसके लिए पैक हुआ |
| `facts.typedWeight` | Why the weight was typed | वज़न हाथ से क्यों डाला |
| `history` | History | इतिहास |
| `historyPacked` | Packed | पैक हुआ |
| `historyImported` | Imported | इम्पोर्ट हुआ |
| `historyHeld` | Held for a dispatch | Dispatch के लिए होल्ड हुआ |
| `historyReleased` | Released from a dispatch | Dispatch से हटा |
| `historyDispatched` | Dispatched | Dispatch हो गया |
| `historyVoided` | Voided | रद्द हुआ |
| `historyRestored` | Restored | वापस आया |
| `openDispatch` | Open dispatch {code} | Dispatch {code} खोलें |
| `openDispatchPlain` | Open the dispatch | Dispatch खोलें |
| `alreadyInDispatch` | Already in {code} | पहले से {code} में है |
| `addNotFound` | This bundle isn't in this company. | यह bundle इस कंपनी में नहीं है। |
| `addFailed` | The bundle wasn't added. Try again. | Bundle नहीं जुड़ा। दोबारा कोशिश करें। |
| `newDispatch` | New dispatch | नया dispatch |
| `dispatchesLoadError` | Dispatches didn't load. Try again. | Dispatch लोड नहीं हुए। दोबारा कोशिश करें। |
| `reasonRequired` | Write why this bundle is void. | लिखें कि यह bundle क्यों रद्द है। |
| `howToReprint` | How to reprint | दोबारा प्रिंट कैसे करें |
| `howToVoid` | How to void or restore | रद्द या वापस कैसे करें |
| `actionsLabel` | Bundle actions | Bundle के काम |
| `transitionFailed` | The bundle didn't change. Try again. | Bundle नहीं बदला। दोबारा कोशिश करें। |
| `changedElsewhere` | This bundle changed since you opened it. The page now shows where it is. | आपके खोलने के बाद यह bundle बदल गया। पेज अब इसकी अभी की हालत दिखा रहा है। |
| `historyChanged` | Changed to {status} | स्टेटस बदला: {status} |
| `reasonLine` | Reason: {reason} | कारण: {reason} |
| `inDispatch` | In dispatch {code} | Dispatch {code} में |
| `addToDispatch` | Add to dispatch | Dispatch में जोड़ें |
| `chooseDispatch` | Choose a dispatch | Dispatch चुनें |
| `noBuildingDispatches` | No dispatch is being built. Start one from Dispatch. | अभी कोई dispatch नहीं बन रहा। Dispatch पेज से नया शुरू करें। |
| `addedToDispatch` | Added to {code} | {code} में जोड़ दिया |
| `reprint` | Reprint label | लेबल फिर से प्रिंट करें |
| `void` | Void bundle | Bundle रद्द करें |
| `restore` | Restore bundle | Bundle वापस लाएं |
| `voidTitle` | Void this bundle? | यह bundle रद्द करें? |
| `voidBody` | A void bundle can't go into a dispatch. You can restore it later. | रद्द bundle किसी dispatch में नहीं जा सकता। बाद में इसे वापस ला सकते हैं। |
| `restoreTitle` | Restore this bundle? | यह bundle वापस लाएं? |
| `restoreBody` | It goes back to In stock. | यह फिर से स्टॉक में आ जाएगा। |
| `reason` | Reason | कारण |
| `reasonHint` | For example: packed twice, wrong weight entered. | जैसे: दो बार पैक हुआ, गलत वज़न डाला। |
| `voided` | Bundle voided | Bundle रद्द हो गया |
| `restored` | Bundle restored | Bundle वापस आ गया |
| `publicSignIn` | Sign in to see stock details | स्टॉक की जानकारी देखने के लिए साइन इन करें |
| `ambiguousTitle` | Which bundle? | कौन सा bundle? |
| `ambiguousBody` | More than one bundle has the number {code}. Pick the year it was packed. | {code} नंबर के एक से ज़्यादा bundle हैं। जिस साल पैक हुआ वह साल चुनें। |
| `byActor` | by {name} | {name} ने |

### dispatch (206)

| Key | English | हिंदी |
|---|---|---|
| `scope.one_so` | This plant sends one sales order per packing list. | यह प्लांट एक packing list में एक सेल्स ऑर्डर भेजता है। |
| `scope.one_customer` | This plant sends one customer per packing list. | यह प्लांट एक packing list में एक ग्राहक भेजता है। |
| `scope.per_truck` | This plant can put several customers on one truck, each with its own packing list. | यह प्लांट एक ट्रक में कई ग्राहक भेज सकता है, हर एक की अपनी packing list। |
| `truck.title` | On this truck | इस ट्रक में |
| `truck.hint` | Vehicle, driver and transporter are the truck's. Each customer keeps its own packing list. | गाड़ी, ड्राइवर और ट्रांसपोर्टर ट्रक के हैं। हर ग्राहक की अपनी packing list रहती है। |
| `truck.pick` | Same truck as | इसी ट्रक में |
| `truck.none` | A truck of its own | अलग ट्रक |
| `truck.option` | {code}, {customer}, {vehicle} | {code}, {customer}, {vehicle} |
| `truck.noVehicle` | no vehicle yet | गाड़ी अभी नहीं |
| `truck.add` | Add another customer to this truck | इस ट्रक में एक और ग्राहक जोड़ें |
| `truck.item` | {code}, {customer} | {code}, {customer} |
| `offBand.chip` | {kg} kg/12ft, the order says {line} | {kg} kg/12ft, ऑर्डर में {line} |
| `fromOrder.start` | Start from | शुरू करें |
| `fromOrder.byCustomer` | Customer | ग्राहक से |
| `fromOrder.tab` | From sales order | सेल्स ऑर्डर से |
| `fromOrder.order` | Sales order | सेल्स ऑर्डर |
| `fromOrder.hint` | The order's customer becomes the dispatch's customer. | ऑर्डर का ग्राहक ही dispatch का ग्राहक बन जाता है। |
| `fromOrder.search` | Search by number, PO or customer | नंबर, PO या ग्राहक से खोजें |
| `fromOrder.baki` | Baki {kg} kg | बाकी {kg} kg |
| `fromOrder.required` | Pick the sales order. | सेल्स ऑर्डर चुनें। |
| `order.title` | Order {number} | ऑर्डर {number} |
| `order.baki` | Baki now | अभी बाकी |
| `order.onLoad` | On this load | इस लोड में |
| `order.left` | Left after this load | इस लोड के बाद बाकी |
| `order.done` | Order complete with this load | इस लोड से ऑर्डर पूरा |
| `order.over` | {kg} kg over the baki | बाकी से {kg} kg ज़्यादा |
| `order.lines` | Lines of this order | इस ऑर्डर की लाइनें |
| `order.lineShort` | Line {n}, die {die} | लाइन {n}, die {die} |
| `order.lineFigures` | Baki {baki}, load {load}, left {left} kg | बाकी {baki}, लोड {load}, बचा {left} kg |
| `order.others` | {count} {count:bundle goes\|bundles go} to other orders of this customer: {orders} | {count} bundle इस ग्राहक के दूसरे ऑर्डर पर जा रहे {count:है\|हैं}: {orders} |
| `suggest.button` | Suggest bundles | Bundle सुझाएं |
| `suggest.title` | Suggest bundles | Bundle सुझाएं |
| `suggest.intro` | This order's stock first, then plant stock of the same die and length. | पहले इस ऑर्डर का स्टॉक, फिर उसी die और लंबाई का प्लांट स्टॉक। |
| `suggest.left` | Left to send after this load: {kg} kg | इस लोड के बाद भेजना बाकी: {kg} kg |
| `suggest.added` | Added {count} {count:bundle\|bundles} | {count} bundle जुड़े |
| `suggest.nothingAdded` | Nothing was added | कुछ नहीं जुड़ा |
| `suggest.empty` | No bundles to suggest. Nothing of this order lies in the yard, and no plant stock matches its dies and lengths. | सुझाने के लिए कोई bundle नहीं। इस ऑर्डर का कुछ यार्ड में नहीं है और प्लांट स्टॉक में इसकी die और लंबाई का कुछ नहीं। |
| `suggest.addAll` | Add {count} that fit ({kg} kg) | {count} जोड़ें जो समाएं ({kg} kg) |
| `suggest.order` | This order's stock | इस ऑर्डर का स्टॉक |
| `suggest.plant` | Plant stock, same die and length | प्लांट स्टॉक, वही die और लंबाई |
| `suggest.forLine` | line {n} | लाइन {n} |
| `suggest.held` | Held for this line | इस लाइन के लिए रोका हुआ |
| `suggest.pastBaki` | Past the baki | बाकी से ज़्यादा |
| `suggest.cut` | The list is cut. Add these and ask again. | सूची कटी हुई है। इन्हें जोड़कर फिर देखें। |
| `suggest.progress` | Adding {done} of {total}… | {total} में से {done} जुड़ रहे हैं… |
| `suggest.partial` | Added {added} of {total}. The rest was not added: {reason} | {total} में से {added} जुड़े। बाकी नहीं जुड़े: {reason} |
| `title` | Dispatch | Dispatch |
| `newDispatch` | New dispatch | नया dispatch |
| `columns.code` | Code | कोड |
| `columns.customer` | Customer | ग्राहक |
| `columns.shipDate` | Ship date | भेजने की तारीख |
| `columns.bundles` | Bundles | Bundle |
| `columns.kg` | kg | kg |
| `columns.status` | Status | स्टेटस |
| `empty` | No dispatches here. | यहां कोई dispatch नहीं है। |
| `emptyBuilding` | Nothing is being built. Start a new dispatch. | अभी कुछ नहीं बन रहा। नया dispatch शुरू करें। |
| `emptyHeld` | Nothing is held right now. | अभी कुछ होल्ड पर नहीं है। |
| `emptyDispatched` | Nothing has been dispatched yet. | अभी तक कोई dispatch नहीं हुआ। |
| `emptyCancelled` | No cancelled dispatches. | कोई कैंसल dispatch नहीं है। |
| `emptySearch` | No dispatch matches "{query}". | "{query}" से कोई dispatch नहीं मिला। |
| `showBuilding` | Show open dispatches | चालू dispatch दिखाएं |
| `openTab` | Open | चालू |
| `emptyOpen` | No dispatch is being built or held. Start a new dispatch. | कोई dispatch न बन रहा है न होल्ड पर है। नया dispatch शुरू करें। |
| `show` | Show | दिखाएं |
| `search` | Search dispatches | Dispatch खोजें |
| `searchHint` | Code or notes | कोड या नोट |
| `listLabel` | Dispatches | Dispatch |
| `loadError` | Dispatches didn't load. Check the connection and try again. | Dispatch लोड नहीं हुए। इंटरनेट देखें और फिर से कोशिश करें। |
| `volume.title` | Dispatch volume | Dispatch मात्रा |
| `volume.subtitle` | kg dispatched per month, last 12 months | हर महीने dispatch हुआ kg, पिछले 12 महीने |
| `volume.label` | Dispatch volume, kg per month | Dispatch मात्रा, हर महीने kg |
| `volume.month` | Month | महीना |
| `volume.kg` | Dispatched | Dispatch हुआ |
| `new.title` | New dispatch | नया dispatch |
| `new.customer` | Customer | ग्राहक |
| `new.customerSearch` | Search customers | ग्राहक खोजें |
| `new.newCustomer` | New customer | नया ग्राहक |
| `new.shipDate` | Ship date | भेजने की तारीख |
| `new.notes` | Notes | नोट |
| `new.submit` | Create dispatch | Dispatch बनाएं |
| `new.customerHint` | Recent customers first. Type to search. | हाल के ग्राहक पहले। खोजने के लिए टाइप करें। |
| `new.customerRequired` | Pick a customer. | ग्राहक चुनें। |
| `new.customerName` | Customer name | ग्राहक का नाम |
| `new.customerPhone` | Phone | फ़ोन |
| `new.addCustomer` | Add customer | ग्राहक जोड़ें |
| `new.customerAdded` | Added {name} | {name} जोड़ा गया |
| `new.created` | Created {code} | {code} बन गया |
| `new.shipDateHint` | Leave it blank if the date isn't fixed yet. | तारीख तय न हो तो खाली छोड़ दें। |
| `new.noAccess` | Your role can't start a dispatch. Ask the office to create one. | आपका रोल dispatch शुरू नहीं कर सकता। ऑफ़िस से बनवाएं। |
| `detail.loadError` | This dispatch didn't load. Check the connection and try again. | यह dispatch लोड नहीं हुआ। इंटरनेट देखें और फिर से कोशिश करें। |
| `detail.shipOn` | Ship {date} | {date} को भेजना है |
| `detail.noShipDate` | No ship date | भेजने की तारीख तय नहीं |
| `detail.dispatchedOn` | Dispatched {date} | {date} को dispatch हुआ |
| `detail.editDetails` | Edit details | जानकारी बदलें |
| `detail.saveDetails` | Save details | जानकारी सेव करें |
| `detail.detailsSaved` | Details saved | जानकारी सेव हो गई |
| `detail.viewOnly` | You can see this dispatch. Changes are made by the office. | आप यह dispatch देख सकते हैं। बदलाव ऑफ़िस करता है। |
| `detail.justDispatched` | {code} dispatched | {code} dispatch हो गया |
| `steps.build` | Build | बनाएं |
| `steps.hold` | Hold | होल्ड |
| `steps.dispatch` | Dispatch | Dispatch |
| `build.scanBundles` | Scan bundles | Bundle स्कैन करें |
| `build.pasteSerials` | Paste serials | Serial पेस्ट करें |
| `build.searchAdd` | Search to add | खोज कर जोड़ें |
| `build.empty` | No bundles yet. Scan a label to add the first one. | अभी कोई bundle नहीं है। पहला bundle जोड़ने के लिए लेबल स्कैन करें। |
| `build.groupTotal` | {bundles} {bundles:bundle\|bundles} · {kg} kg | {bundles} bundle · {kg} kg |
| `build.groupLabel` | Packing group label | पैकिंग ग्रुप लेबल |
| `build.removeBundle` | Remove {serial} | {serial} हटाएं |
| `build.removed` | Removed {serial} | {serial} हटा दिया |
| `build.undo` | Undo | वापस लाएं |
| `build.added` | Added {serial} | {serial} जुड़ा |
| `build.bundlesIn` | Bundles in this dispatch | इस dispatch के bundle |
| `build.colBundle` | Bundle no | Bundle नंबर |
| `build.colWeight` | Weight kg | वज़न kg |
| `build.colPcs` | Pcs | पीस |
| `build.colLength` | Cut length | कट लंबाई |
| `build.colKg12` | kg/12ft | kg/12ft |
| `build.colActions` | Actions | काम |
| `build.setLabel` | Set label | लेबल लगाएं |
| `build.changeLabel` | Change label | लेबल बदलें |
| `build.labelFor` | Packing group label for {group} | {group} का पैकिंग ग्रुप लेबल |
| `build.labelHint` | A short mark like A or B. It groups these bundles on the packing list. | A या B जैसा छोटा निशान। पैकिंग लिस्ट में ये bundle एक साथ आएंगे। |
| `build.saveLabel` | Save label | लेबल सेव करें |
| `build.clearLabel` | Remove label | लेबल हटाएं |
| `build.labelSaved` | Label saved | लेबल सेव हो गया |
| `build.labelCleared` | Label removed | लेबल हट गया |
| `build.labelPartial` | Saved on {done} of {total} bundles. Save again for the rest. | {total} में से {done} bundle पर सेव हुआ। बाकी के लिए फिर से सेव करें। |
| `build.groupNamed` | Group {label} | ग्रुप {label} |
| `build.searchTitle` | Search to add | खोज कर जोड़ें |
| `build.searchLabel` | Serial or PO | Serial या PO |
| `build.searchHint` | Only bundles in stock are listed. | सिर्फ़ स्टॉक वाले bundle दिखते हैं। |
| `build.searchStart` | Type part of a serial or PO number. | Serial या PO नंबर का कुछ हिस्सा टाइप करें। |
| `build.searchEmpty` | No bundle in stock matches "{query}". | "{query}" से स्टॉक में कोई bundle नहीं मिला। |
| `build.add` | Add | जोड़ें |
| `build.inDispatch` | Added | जुड़ गया |
| `build.notHeld` | Not held | होल्ड नहीं |
| `build.labelNotBack` | {serial} is back without its label {label}. Set the label again. | {serial} वापस आ गया, पर लेबल {label} के बिना। लेबल फिर से लगाएं। |
| `build.blockedBuild` | {count} {count:bundle\|bundles} can't be held. Remove {count:it\|them} to go on. | {count} bundle होल्ड नहीं हो {count:सकता\|सकते}। आगे बढ़ने के लिए {count:इसे\|इन्हें} हटाएं। |
| `build.blockedHeld` | {count} {count:bundle\|bundles} can't go out. Release the stock, remove {count:it\|them}, then hold again. | {count} bundle नहीं जा {count:सकता\|सकते}। होल्ड हटाएं, {count:इसे\|इन्हें} हटाएं, फिर से होल्ड करें। |
| `paste.title` | Paste serials | Serial पेस्ट करें |
| `paste.label` | Serials | Serial |
| `paste.hint` | One per line, or separated by commas or spaces. | हर लाइन में एक, या कॉमा या स्पेस से अलग करके। |
| `paste.submit` | Add bundles | Bundle जोड़ें |
| `paste.added` | {count} added | {count} {count:जुड़ा\|जुड़े} |
| `paste.already` | {count} already in this dispatch | {count} इस dispatch में पहले से {count:है\|हैं} |
| `paste.notFound` | {count} not found | {count} नहीं {count:मिला\|मिले} |
| `paste.unavailable` | {count} not available | {count} उपलब्ध नहीं {count:है\|हैं} |
| `paste.found` | {count} {count:serial\|serials} to add | जोड़ने के लिए {count} serial |
| `paste.adding` | Adding {done} of {total} | {total} में से {done} जोड़ रहे हैं |
| `paste.nothingFound` | No serials found. Paste one per line. | कोई serial नहीं मिला। हर लाइन में एक पेस्ट करें। |
| `paste.reportTitle` | What happened | क्या हुआ |
| `paste.pasteMore` | Paste more | और पेस्ट करें |
| `paste.stopped` | Stopped after {done} of {total}. The rest weren't sent. | {total} में से {done} के बाद रुक गया। बाकी नहीं भेजे गए। |
| `holdStock` | Hold stock | स्टॉक होल्ड करें |
| `held` | Stock held | स्टॉक होल्ड हो गया |
| `heldNote` | Bundles you add now are held straight away. | अब जो bundle जोड़ेंगे, वो तुरंत होल्ड हो जाएंगे। |
| `release` | Release | होल्ड हटाएं |
| `released` | Stock released | होल्ड हट गया |
| `dispatchAction` | Dispatch | Dispatch करें |
| `confirmTitle` | Dispatch {code}? | {code} dispatch करें? |
| `confirmBody` | {bundles} {bundles:bundle\|bundles} · {kg} kg for {customer}. You can't add or remove bundles after this. | {customer} के लिए {bundles} bundle · {kg} kg। इसके बाद bundle जोड़ या हटा नहीं सकेंगे। |
| `confirm` | Dispatch | Dispatch करें |
| `dispatched` | Dispatched | Dispatch हो गया |
| `cancel` | Cancel dispatch | Dispatch कैंसल करें |
| `cancelTitle` | Cancel this dispatch? | यह dispatch कैंसल करें? |
| `cancelBody` | Held bundles go back to stock. | होल्ड वाले bundle वापस स्टॉक में चले जाएंगे। |
| `cancelled` | Dispatch cancelled | Dispatch कैंसल हो गया |
| `delete` | Delete dispatch | Dispatch डिलीट करें |
| `deleteTitle` | Delete this dispatch? | यह dispatch डिलीट करें? |
| `deleteBody` | The dispatch is removed. Its bundles stay in stock. | Dispatch हट जाएगा। इसके bundle स्टॉक में ही रहेंगे। |
| `deleted` | Dispatch deleted | Dispatch डिलीट हो गया |
| `holdHint` | Holding keeps these bundles for {customer}. Nobody can add them to another dispatch. | होल्ड करने से ये bundle {customer} के लिए रुक जाते हैं। कोई इन्हें दूसरे dispatch में नहीं जोड़ सकता। |
| `releaseTitle` | Release the held stock? | होल्ड हटाएं? |
| `releaseBody` | The bundles go back to stock and this dispatch goes back to Building. | Bundle वापस स्टॉक में जाएंगे और यह dispatch फिर से बनने लगेगा। |
| `errors.empty` | Add at least one bundle first. | पहले कम से कम एक bundle जोड़ें। |
| `errors.conflict` | Some bundles changed since this page loaded. The ones that can't go are marked in the list. | पेज खुलने के बाद कुछ bundle बदल गए। जो नहीं जा सकते, उन पर लिस्ट में निशान है। |
| `errors.moved` | This dispatch has moved on. Reload to see where it is now. | यह dispatch आगे बढ़ चुका है। ताज़ा स्थिति के लिए पेज रीलोड करें। |
| `capacity.label` | Truck capacity (kg) | गाड़ी की क्षमता (kg) |
| `capacity.fill` | {pct}% full | {pct}% भरी |
| `capacity.near` | Nearly full | लगभग भरी |
| `capacity.over` | {kg} kg over capacity | क्षमता से {kg} kg ज़्यादा |
| `capacity.overReason` | Why load over capacity | क्षमता से ज़्यादा क्यों लोड किया |
| `capacity.hint` | Leave it blank for no warning. | चेतावनी न चाहिए तो खाली छोड़ें। |
| `capacity.invalid` | Enter the capacity in kg, for example 9000. | क्षमता kg में डालें, जैसे 9000। |
| `capacity.loaded` | {loaded} of {capacity} kg | {capacity} kg में से {loaded} kg |
| `capacity.locked` | The capacity this load went against stays as it was. | जिस क्षमता पर यह लोड गया, वह वैसी ही रहती है। |
| `capacity.overReasonHint` | Say why this truck goes over its capacity. It is kept with the dispatch. | बताएं कि यह ट्रक अपनी क्षमता से ज़्यादा क्यों जा रहा है। यह डिस्पैच के साथ सेव रहता है। |
| `capacity.reasonRequired` | Say why before you dispatch. | डिस्पैच से पहले कारण लिखें। |
| `value.title` | Value | मूल्य |
| `value.priced` | {kg} kg priced at the order rate | {kg} kg ऑर्डर रेट पर |
| `value.missing` | {count} {count:bundle has\|bundles have} no rate on the order line ({kg} kg) | {count} bundle की ऑर्डर लाइन पर रेट नहीं है ({kg} kg) |
| `value.complete` | Every bundle has a rate | हर bundle पर रेट है |
| `value.note` | From the rate on each order line, on weighed kg. Not a tax invoice. | हर ऑर्डर लाइन के रेट से, तौले गए kg पर। यह टैक्स इनवॉइस नहीं है। |
| `transporter.label` | Transporter | ट्रांसपोर्टर |
| `transporter.add` | Add transporter | ट्रांसपोर्टर जोड़ें |
| `transporter.none` | No transporter | कोई ट्रांसपोर्टर नहीं |
| `transporter.name` | Transporter name | ट्रांसपोर्टर का नाम |
| `transporter.phone` | Phone | फोन |
| `transporter.save` | Save transporter | ट्रांसपोर्टर सेव करें |
| `transporter.added` | Added {name} | {name} जुड़ा |
| `header.vehicleNo` | Vehicle number | गाड़ी नंबर |
| `header.vehicleHint` | Letters and digits. Spaces and dashes are dropped. | सिर्फ अक्षर और अंक। खाली जगह और डैश हटा दिए जाते हैं। |
| `header.driverName` | Driver | ड्राइवर |
| `header.driverPhone` | Driver phone | ड्राइवर का फोन |
| `header.invoiceNumber` | Tally invoice number | Tally इनवॉइस नंबर |
| `header.invoiceDate` | Invoice date | इनवॉइस की तारीख |

### packingList (93)

| Key | English | हिंदी |
|---|---|---|
| `kgPerPiece` | Show kg per piece | प्रति पीस kg दिखाएं |
| `kgPerPieceOn` | This plant shows kg per piece on the list. | यह प्लांट सूची में प्रति पीस kg दिखाता है। |
| `kgPerPieceFailed` | Could not save the setting. Try again. | सेटिंग सेव नहीं हुई। फिर कोशिश करें। |
| `title` | Packing list | पैकिंग लिस्ट |
| `plNo` | PL no | PL नंबर |
| `date` | Date | तारीख |
| `shipDate` | Ship date | भेजने की तारीख |
| `customer` | Customer | ग्राहक |
| `totals` | {bundles} {bundles:bundle\|bundles} · {kg} kg | {bundles} bundle · {kg} kg |
| `columns.kgPerPiece` | kg/pc | kg/पीस |
| `columns.sr` | Sr | क्र. |
| `columns.bundleNo` | Bundle no | Bundle नंबर |
| `columns.item` | Item | आइटम |
| `columns.weightKg` | Weight kg | वज़न kg |
| `columns.cutLengthFt` | Cut length ft | कट लंबाई ft |
| `columns.cutLengthIn` | Cut length in | कट लंबाई in |
| `columns.pcs` | Pcs | पीस |
| `columns.kgPer12ft` | kg/12ft | kg/12ft |
| `columns.weightRange` | Weight range /12' | वज़न रेंज /12' |
| `columns.section` | Section | सेक्शन |
| `columns.po` | PO | PO |
| `columns.originalSo` | Original order | मूल ऑर्डर |
| `groupTotal` | Group total | ग्रुप का कुल |
| `grandTotal` | Total | कुल |
| `downloadPdf` | Download PDF | PDF डाउनलोड करें |
| `downloadExcel` | Download Excel | Excel डाउनलोड करें |
| `share` | Share | शेयर करें |
| `regenerate` | Regenerate | फिर से बनाएं |
| `regenerateTitle` | Regenerate the packing list? | पैकिंग लिस्ट फिर से बनाएं? |
| `regenerateBody` | orrn builds it again from the bundles in this dispatch as they are now. | orrn इस dispatch के bundle की अभी की जानकारी से इसे फिर से बनाएगा। |
| `regenerated` | Packing list regenerated | पैकिंग लिस्ट फिर से बन गई |
| `dispatch` | Dispatch | Dispatch |
| `gstin` | GSTIN | GSTIN |
| `notSet` | Not set | तय नहीं |
| `rowsLabel` | Packing list rows | पैकिंग लिस्ट की लाइनें |
| `groupNamed` | Group {label} | ग्रुप {label} |
| `groupTotalOf` | Total {label} | {label} का कुल |
| `loadError` | This packing list couldn't be read. Regenerate it to build it again. | यह पैकिंग लिस्ट पढ़ी नहीं जा सकी। इसे फिर से बनाएं। |
| `missing` | This dispatch has no packing list yet. | इस dispatch की पैकिंग लिस्ट अभी नहीं बनी। |
| `make` | Make packing list | पैकिंग लिस्ट बनाएं |
| `made` | Packing list made | पैकिंग लिस्ट बन गई |
| `downloadFailed` | The file couldn't be made. Try again. | फ़ाइल नहीं बन पाई। फिर से कोशिश करें। |
| `v2.revision` | Revision {n} | संशोधन {n} |
| `v2.regenerate` | Make a new revision | नया संशोधन बनाएं |
| `v2.changes` | Changes from revision {n} | संशोधन {n} से बदलाव |
| `v2.added` | {count} added | {count} {count:जुड़ा\|जुड़े} |
| `v2.removed` | {count} removed | {count} हटे |
| `v2.changed` | {count} changed | {count} बदले |
| `v2.same` | No changes | कोई बदलाव नहीं |
| `v2.combine` | Combine lists | लिस्ट मिलाएं |
| `v2.combinedInto` | Combined into {code} | {code} में मिलाई गई |
| `v2.showBranding` | Show company name | कंपनी का नाम दिखाएं |
| `v2.showOriginalSo` | Show original order | पहला ऑर्डर दिखाएं |
| `v2.partyNo` | Party no. | पार्टी नंबर |
| `v2.summary.hollow` | Hollow | हॉलो |
| `v2.summary.solid` | Solid | सॉलिड |
| `v2.summary.semi` | Semi hollow | सेमी हॉलो |
| `v2.revisions` | Revisions | रिवीज़न |
| `v2.revisionShort` | Rev {n} | रिव {n} |
| `v2.current` | Current | मौजूदा |
| `v2.superseded` | Sent earlier | पहले भेजा गया |
| `v2.combinedChip` | Combined | मिलाया गया |
| `v2.open` | Open | खोलें |
| `v2.viewing` | Showing | यही दिख रहा है |
| `v2.andMore` | and {count} more | और {count} |
| `v2.byProfile` | By profile | प्रोफाइल के हिसाब से |
| `v2.backToDispatch` | Dispatch | डिस्पैच |
| `v2.editHeader` | Edit header | हेडर बदलें |
| `v2.partyShort` | Party {number} | पार्टी {number} |
| `v2.sectionTotal` | Total {section} | कुल {section} |
| `v2.thisList` | This list | यह लिस्ट |
| `v2.regenerateTitle` | Make a new revision? | नया रिवीज़न बनाएं? |
| `v2.regenerateBody` | The revision already sent is kept. orrn builds the list again from the bundles as they are now and calls it revision {n}. The PL number {code} stays. | जो रिवीज़न भेजा जा चुका है वह रखा जाता है। orrn अभी के bundle से लिस्ट फिर बनाता है और उसे रिवीज़न {n} कहता है। PL नंबर {code} वही रहता है। |
| `v2.regenerated` | Revision {n} made | रिवीज़न {n} बन गया |
| `v2.brandingHint` | Off hides the logo and tagline. The legal company name still prints. | बंद करने पर लोगो और टैगलाइन हट जाते हैं। कंपनी का कानूनी नाम फिर भी छपता है। |
| `v2.originalSoHint` | Shows the order each bundle was packed for. | हर bundle जिस ऑर्डर के लिए पैक हुआ, वह दिखाता है। |
| `v2.combineTitle` | Combine packing lists | पैकिंग लिस्ट मिलाएं |
| `v2.combineBody` | Pick the lists of {customer} to fold into one list. It takes a new PL number; the folded lists keep theirs. | {customer} की जो लिस्ट एक में मिलानी हैं, चुनें। नई लिस्ट को नया PL नंबर मिलता है; मिलाई गई लिस्ट अपना नंबर रखती हैं। |
| `v2.combineNone` | No other packing list of this customer to combine. | इस ग्राहक की मिलाने लायक कोई और पैकिंग लिस्ट नहीं है। |
| `v2.combineSubmit` | Combine {count} lists | {count} लिस्ट मिलाएं |
| `v2.combined` | Combined into {code} | {code} में मिलाया |
| `v2.field.weightG` | weight | वज़न |
| `v2.field.pcs` | pieces | पीस |
| `v2.field.lengthMm` | length | लंबाई |
| `v2.field.partyNo` | party number | पार्टी नंबर |
| `billTo` | Bill to | बिल किसे |
| `shipTo` | Ship to | माल कहां |
| `vehicle` | Vehicle | गाड़ी |
| `driver` | Driver | ड्राइवर |
| `transporter` | Transporter | ट्रांसपोर्टर |
| `po` | PO | PO |
| `invoice` | Invoice | इनवॉइस |
| `print` | Print | प्रिंट |

### dies (67)

| Key | English | हिंदी |
|---|---|---|
| `title` | Dies | Die |
| `subtitle` | Weight bands and measurements for every die. | हर die का वज़न रेंज और नाप। |
| `newDie` | New die | नया die |
| `search` | Search code, series or section | कोड, सीरीज़ या सेक्शन खोजें |
| `searchLabel` | Search dies | Die खोजें |
| `listLabel` | Dies | Die |
| `columns.code` | Die | Die |
| `columns.series` | Series | सीरीज़ |
| `columns.section` | Section | सेक्शन |
| `columns.name` | Name | नाम |
| `columns.range` | Range (kg/12ft) | रेंज (kg/12ft) |
| `columns.status` | Status | स्टेटस |
| `rangeValue` | {min}-{max} | {min}-{max} |
| `unnamed` | No name | कोई नाम नहीं |
| `empty` | No dies yet. | अभी कोई die नहीं है। |
| `emptyBody` | Add a die, or import the catalogue from a CSV file. | Die जोड़ें, या CSV फ़ाइल से कैटलॉग इम्पोर्ट करें। |
| `emptyAction` | Add a die | Die जोड़ें |
| `importCsv` | Import CSV | CSV इम्पोर्ट करें |
| `pageEmpty` | Nothing on this page. | इस पेज पर कुछ नहीं है। |
| `firstPage` | Go to the first page | पहले पेज पर जाएं |
| `detail.band` | Weight per 12 ft | 12 ft का वज़न |
| `detail.bandValue` | {min} to {max} | {min} से {max} |
| `detail.measurements` | Measurements | नाप |
| `detail.noMeasurements` | No measurements yet. | अभी कोई नाप नहीं है। |
| `detail.code` | Code | कोड |
| `detail.seeStock` | See stock | स्टॉक देखें |
| `detail.edit` | Edit die | Die बदलें |
| `detail.editTitle` | Edit die {code} | Die {code} बदलें |
| `detail.notFound` | This die doesn't exist or was deleted. | यह die नहीं मिला या डिलीट हो गया है। |
| `detail.backToList` | Back to dies | Die की लिस्ट पर वापस |
| `detail.delete` | Delete die | Die डिलीट करें |
| `detail.deleteTitle` | Delete die {code}? | Die {code} डिलीट करें? |
| `detail.deleteBody` | It leaves this list and Pack. Bundles already packed keep it. | यह इस लिस्ट और पैकिंग से हट जाएगा। जो bundle पैक हो चुके हैं, उनमें यह रहेगा। |
| `detail.deleted` | Die deleted | Die डिलीट हो गया |
| `detail.loadFailed` | This die didn't load. Check the connection and try again. | यह die लोड नहीं हुआ। इंटरनेट जांच कर फिर से कोशिश करें। |
| `form.titleNew` | New die | नया die |
| `form.titleEdit` | Die {code} | Die {code} |
| `form.series` | Series | सीरीज़ |
| `form.sectionCode` | Section code | सेक्शन कोड |
| `form.name` | Name | नाम |
| `form.weightMin` | Min weight (kg/12ft) | कम से कम वज़न (kg/12ft) |
| `form.weightMax` | Max weight (kg/12ft) | ज़्यादा से ज़्यादा वज़न (kg/12ft) |
| `form.rangeHint` | Weight of one 12 ft length, in kg. | 12 ft लंबाई का वज़न, kg में। |
| `form.rangeOrder` | Max weight can't be less than min weight. | ज़्यादा से ज़्यादा वज़न, कम से कम वज़न से कम नहीं हो सकता। |
| `form.status` | Status | स्टेटस |
| `form.statusHint` | Archived dies don't show in Pack. | बंद die पैकिंग में नहीं दिखते। |
| `form.notes` | Notes | नोट |
| `form.advanced` | Advanced | एडवांस |
| `form.advancedHint` | Width, thickness and leg. All optional. | चौड़ाई, मोटाई और लेग। सब ज़रूरी नहीं। |
| `form.measureHintMm` | In mm. | mm में। |
| `form.measureHintInch` | In inches, like 0.125 for 1/8 in. | इंच में, जैसे 1/8 in के लिए 0.125। |
| `form.width` | Width | चौड़ाई |
| `form.thickness` | Thickness | मोटाई |
| `form.leg` | Leg | लेग |
| `form.submit` | Save die | Die सेव करें |
| `form.saved` | Die saved | Die सेव हो गया |
| `form.codeTaken` | This code belongs to a deleted die. Use a different code. | यह कोड एक डिलीट हुए die का है। दूसरा कोड डालें। |
| `form.duplicate` | A die with this series and section code already exists. | इस सीरीज़ और सेक्शन कोड का die पहले से है। |
| `form.fixErrors` | Check the fields marked in red. | लाल निशान वाले खाने जांचें। |
| `form.cantAdd` | Your role can't add dies. Ask an admin if you need it. | आपका रोल die नहीं जोड़ सकता। ज़रूरत हो तो एडमिन से कहें। |
| `form.shapeSection` | Shape and owner | आकार और मालिक |
| `form.profileNone` | Not set | तय नहीं |
| `form.alloyHint` | Pick one or type another. | एक चुनें या दूसरा लिखें। |
| `form.wallHint` | Millimetres, like 1.2. Blank means not written. | मिलीमीटर में, जैसे 1.2। खाली मतलब लिखा नहीं है। |
| `form.ownerSearch` | Search customers | ग्राहक खोजें |
| `form.ownerHint` | Blank means the plant owns this die. | खाली मतलब यह die प्लांट की है। |
| `form.ownerClear` | Make plant-owned | प्लांट की करें |

### customers (111)

| Key | English | हिंदी |
|---|---|---|
| `title` | Customers | ग्राहक |
| `subtitle` | Who buys from the plant, and how much. | प्लांट से कौन खरीदता है, और कितना। |
| `newCustomer` | New customer | नया ग्राहक |
| `search` | Search name, phone or GSTIN | नाम, फ़ोन या GSTIN खोजें |
| `searchLabel` | Search customers | ग्राहक खोजें |
| `listLabel` | Customers | ग्राहक |
| `columns.name` | Name | नाम |
| `columns.phone` | Phone | फ़ोन |
| `columns.gstin` | GSTIN | GSTIN |
| `columns.city` | City | शहर |
| `columns.kg` | Dispatched (kg) | Dispatch हुआ (kg) |
| `empty` | No customers yet. | अभी कोई ग्राहक नहीं है। |
| `emptyBody` | Add a customer before their first dispatch. | पहले dispatch से पहले ग्राहक जोड़ें। |
| `emptyAction` | Add a customer | ग्राहक जोड़ें |
| `importCsv` | Import CSV | CSV इम्पोर्ट करें |
| `pageEmpty` | Nothing on this page. | इस पेज पर कुछ नहीं है। |
| `firstPage` | Go to the first page | पहले पेज पर जाएं |
| `kgFailed` | The dispatched kg didn't load. | Dispatch हुआ kg लोड नहीं हुआ। |
| `period.label` | Period | समय |
| `period.month` | This month | इस महीने |
| `period.quarter` | This quarter | इस तिमाही |
| `period.fy` | This year | इस साल |
| `period.range` | {from} to {to} | {from} से {to} |
| `leaderboard.title` | Who is leading | सबसे आगे कौन |
| `leaderboard.subtitle` | kg dispatched per customer. {total} kg in all. | हर ग्राहक को dispatch हुआ kg। कुल {total} kg। |
| `leaderboard.subtitleShort` | kg dispatched per customer. | हर ग्राहक को dispatch हुआ kg। |
| `leaderboard.label` | Customers by kg dispatched | dispatch हुए kg के हिसाब से ग्राहक |
| `leaderboard.otherShare` | Other customers ({share}) | बाकी ग्राहक ({share}) |
| `leaderboard.valueHeader` | Dispatched | Dispatch हुआ |
| `form.titleNew` | New customer | नया ग्राहक |
| `form.name` | Name | नाम |
| `form.nameHint` | As it should print on the packing list. | जैसा पैकिंग लिस्ट पर छपना चाहिए। |
| `form.phone` | Phone | फ़ोन |
| `form.email` | Email | ईमेल |
| `form.gstin` | GSTIN | GSTIN |
| `form.gstinHint` | 15 characters, from the customer's GST certificate. | 15 अक्षर, ग्राहक के GST सर्टिफिकेट से। |
| `form.gstinInvalid` | A GSTIN has 15 letters and numbers. Check it and try again. | GSTIN में 15 अक्षर और अंक होते हैं। जांच कर फिर से डालें। |
| `form.gstinLegacy` | This GSTIN isn't 15 letters and numbers. Check it against the GST certificate when you can. | यह GSTIN 15 अक्षर और अंक का नहीं है। समय मिलने पर GST सर्टिफिकेट से मिलाएं। |
| `form.notes` | Notes | नोट |
| `form.billingAddress` | Billing address | बिलिंग का पता |
| `form.shippingAddress` | Shipping address | डिलीवरी का पता |
| `form.sameAsBilling` | Same as billing address | बिलिंग वाला पता ही |
| `form.addressLine` | Address | पता |
| `form.addressLine2` | Address line 2 | पता, दूसरी लाइन |
| `form.city` | City | शहर |
| `form.state` | State | राज्य |
| `form.pincode` | PIN code | पिन कोड |
| `form.submit` | Save customer | ग्राहक सेव करें |
| `form.saved` | Customer saved | ग्राहक सेव हो गया |
| `form.fixErrors` | Check the fields marked in red. | लाल निशान वाले खाने जांचें। |
| `form.cantAdd` | Your role can't add customers. Ask an admin if you need it. | आपका रोल ग्राहक नहीं जोड़ सकता। ज़रूरत हो तो एडमिन से कहें। |
| `detail.gstin` | GSTIN {gstin} | GSTIN {gstin} |
| `detail.lastToday` | Last dispatch today | आखिरी dispatch आज |
| `detail.lastYesterday` | Last dispatch yesterday | आखिरी dispatch कल |
| `detail.lastDaysAgo` | Last dispatch {count} {count:day\|days} ago | आखिरी dispatch {count} दिन पहले |
| `detail.lastNever` | No dispatches yet | अभी कोई dispatch नहीं |
| `detail.cadence` | every ~{count} {count:day\|days} | हर ~{count} दिन में |
| `detail.edit` | Edit customer | ग्राहक बदलें |
| `detail.editTitle` | Edit {name} | {name} बदलें |
| `detail.contact` | Contact | संपर्क |
| `detail.noContact` | No phone or email yet. | अभी कोई फ़ोन या ईमेल नहीं है। |
| `detail.noAddress` | No address yet. | अभी कोई पता नहीं है। |
| `detail.sameAsBilling` | Same as billing address | बिलिंग वाला पता ही |
| `detail.notFound` | This customer doesn't exist or was deleted. | यह ग्राहक नहीं मिला या डिलीट हो गया है। |
| `detail.backToList` | Back to customers | ग्राहकों की लिस्ट पर वापस |
| `detail.loadFailed` | This customer didn't load. Check the connection and try again. | यह ग्राहक लोड नहीं हुआ। इंटरनेट जांच कर फिर से कोशिश करें। |
| `detail.delete` | Delete customer | ग्राहक डिलीट करें |
| `detail.deleteTitle` | Delete {name}? | {name} को डिलीट करें? |
| `detail.deleteBody` | They leave this list and the dispatch picker. Past dispatches and packing lists keep their name. | यह इस लिस्ट और dispatch चुनने की लिस्ट से हट जाएगा। पुराने dispatch और पैकिंग लिस्ट में नाम रहेगा। |
| `detail.deleted` | Customer deleted | ग्राहक डिलीट हो गया |
| `detail.kpi.kg` | Dispatched | Dispatch हुआ |
| `detail.kpi.dispatches` | Dispatches | Dispatch |
| `detail.kpi.avgLoad` | Average load | औसत लोड |
| `detail.kpi.share` | Share of all dispatches | सभी dispatch में हिस्सा |
| `detail.kpi.shareOf` | of {total} kg in all | कुल {total} kg में से |
| `detail.kpi.perDispatch` | kg per dispatch | kg हर dispatch |
| `detail.kpi.analyticsFailed` | These numbers didn't load. | ये आंकड़े लोड नहीं हुए। |
| `detail.kpi.shareFailed` | The total didn't load. | कुल आंकड़ा लोड नहीं हुआ। |
| `detail.volume.title` | Monthly volume | हर महीने का माल |
| `detail.volume.subtitle` | kg dispatched per month, last 12 months | हर महीने dispatch हुआ kg, पिछले 12 महीने |
| `detail.volume.label` | kg dispatched per month | हर महीने dispatch हुआ kg |
| `detail.volume.month` | Month | महीना |
| `detail.volume.value` | Dispatched | Dispatch हुआ |
| `detail.sections.title` | What they buy | क्या खरीदते हैं |
| `detail.sections.subtitle` | Top sections by kg dispatched in this period | इस समय में kg के हिसाब से टॉप सेक्शन |
| `detail.sections.label` | Sections by kg dispatched | dispatch हुए kg के हिसाब से सेक्शन |
| `detail.sections.other` | Other sections | बाकी सेक्शन |
| `detail.sections.otherShare` | Other sections ({share}) | बाकी सेक्शन ({share}) |
| `detail.sections.valueHeader` | Dispatched | Dispatch हुआ |
| `detail.recent.title` | Recent dispatches | हाल के dispatch |
| `detail.recent.label` | Recent dispatches | हाल के dispatch |
| `detail.recent.code` | Dispatch | Dispatch |
| `detail.recent.date` | Date | तारीख |
| `detail.recent.status` | Status | स्टेटस |
| `detail.recent.bundles` | Bundles | Bundle |
| `detail.recent.kg` | kg | kg |
| `detail.openOrders.title` | Open orders | बाकी ऑर्डर |
| `detail.openOrders.ordered` | Ordered | ऑर्डर हुआ |
| `detail.openOrders.dispatched` | Dispatched | Dispatch हुआ |
| `detail.openOrders.baki` | Baki | बाकी |
| `detail.openOrders.lines` | {count} {count:line\|lines} | {count} लाइन |
| `dispatches` | Dispatches | Dispatch |
| `noDispatches` | No dispatches for this customer yet. | इस ग्राहक का अभी कोई dispatch नहीं है। |
| `bundleNumbers.title` | Party bundle numbers | पार्टी bundle नंबर |
| `bundleNumbers.none` | Same as our serial | हमारे serial जैसा |
| `bundleNumbers.monthly` | Monthly, like 26J12 | हर महीने, जैसे 26J12 |
| `bundleNumbers.fy` | Each financial year, like 2026-27/12 | हर वित्त वर्ष, जैसे 2026-27/12 |
| `bundleNumbers.lifelong` | Never reset, like 4086 | कभी शून्य नहीं, जैसे 4086 |
| `bundleNumbers.changeHint` | Old bundles keep their numbers. | पुराने bundle के नंबर नहीं बदलते। |
| `bundleNumbers.saved` | Bundle numbers changed | Bundle नंबर बदले गए |
| `bundleNumbers.change` | Number bundles by | Bundle नंबर इस तरह दें |

### store (189)

| Key | English | हिंदी |
|---|---|---|
| `title` | Store | स्टोर |
| `subtitle` | Chemicals, fuel, gas and spares in the central store. | सेंट्रल स्टोर में केमिकल, ईंधन, गैस और स्पेयर पार्ट। |
| `items` | Store items | स्टोर का सामान |
| `actions.issue` | Issue | माल दें |
| `actions.issueHint` | Give items to the floor | फ़्लोर को सामान दें |
| `actions.receive` | Receive | माल लें |
| `actions.receiveHint` | A delivery came in | डिलीवरी आई है |
| `actions.exchange` | Exchange | पुराना देकर नया |
| `actions.exchangeHint` | Old out, new in | पुराना पार्ट बाहर, नया अंदर |
| `readOnly` | Only the storekeeper makes store entries. You can see what is in the store. | स्टोर की एंट्री सिर्फ़ स्टोरकीपर करता है। स्टोर में क्या है, यह आप देख सकते हैं। |
| `inStore` | In the store | स्टोर में |
| `search` | Search items | सामान खोजें |
| `category` | Category | किस्म |
| `allCategories` | All categories | सारी किस्में |
| `columns.item` | Item | सामान |
| `columns.category` | Category | किस्म |
| `columns.inStore` | In store | स्टोर में |
| `columns.status` | Status | स्थिति |
| `columns.entry` | Entry | एंट्री |
| `columns.quantity` | Quantity | मात्रा |
| `columns.when` | When | कब |
| `columns.details` | Details | ब्योरा |
| `status.empty` | Empty | खाली |
| `status.inStock` | In stock | मौजूद |
| `status.retired` | Retired | बंद |
| `noItems` | No store items yet | स्टोर में अभी कोई सामान नहीं है |
| `noItemsBody` | Add the chemicals, fuel and spares you keep, then receive the first delivery. | जो केमिकल, ईंधन और स्पेयर आप रखते हैं उन्हें जोड़ें, फिर पहली डिलीवरी लें। |
| `noItemsInCategory` | No items in this category | इस किस्म का कोई सामान नहीं है |
| `addItem` | Add item | सामान जोड़ें |
| `noLocation` | Set up the central store first | पहले सेंट्रल स्टोर बनाएं |
| `noLocationBody` | Ask your manager or admin to add a location of the kind Store in Masters, Locations. Until then nothing can be received or issued. | मैनेजर या एडमिन से कहें कि मास्टर, लोकेशन में Store किस्म की लोकेशन जोड़ें। तब तक न माल लिया जा सकता है, न दिया जा सकता है। |
| `noLocationBodyPublisher` | Add a location of the kind Store in Masters, Locations. Until then nothing can be received or issued. | मास्टर, लोकेशन में Store किस्म की लोकेशन जोड़ें। तब तक न माल लिया जा सकता है, न दिया जा सकता है। |
| `loadFailed` | The store did not load. Check the connection and try again. | स्टोर लोड नहीं हुआ। कनेक्शन देखें और फिर से कोशिश करें। |
| `noAccess` | The store is for the storekeeper | स्टोर स्टोरकीपर के लिए है |
| `noAccessBody` | Ask your plant admin if you need to see or change the store. | स्टोर देखना या बदलना हो तो प्लांट एडमिन से पूछें। |
| `noEntryAccess` | Only the storekeeper makes store entries | स्टोर की एंट्री सिर्फ़ स्टोरकीपर करता है |
| `noEntryAccessBody` | You can still see what is in the store. | स्टोर में क्या है, यह आप फिर भी देख सकते हैं। |
| `backToStore` | Store | स्टोर |
| `recent` | Recent entries | हाल की एंट्री |
| `entries` | Entries | एंट्री |
| `noEntries` | No entries yet | अभी कोई एंट्री नहीं है |
| `noEntriesBody` | Deliveries received and items issued show here. | आई हुई डिलीवरी और दिया हुआ माल यहां दिखेगा। |
| `showMore` | Show older entries | पुरानी एंट्री दिखाएं |
| `showingLatest` | Showing the latest {max} entries. | सबसे नई {max} एंट्री दिख रही हैं। |
| `kind.grn` | Received | माल आया |
| `kind.mrs` | Issued | माल दिया |
| `cancelled` | Cancelled | रद्द |
| `purpose.melt` | Melt | मेल्ट |
| `purpose.nitriding` | Nitriding | नाइट्राइडिंग |
| `purpose.maintenance` | Maintenance | मेंटेनेंस |
| `purpose.exchange` | Exchange | बदली |
| `purpose.other` | Other | दूसरा काम |
| `categories.chemical` | Chemical | केमिकल |
| `categories.fuel` | Fuel | ईंधन |
| `categories.gas` | Gas | गैस |
| `categories.spare` | Spare | स्पेयर |
| `categories.other` | Other | दूसरा |
| `unitShort.kg` | kg | kg |
| `unitShort.litre` | L | L |
| `unitShort.piece` | pcs | pcs |
| `unitShort.metre` | m | m |
| `unitShort.set` | {count:set\|sets} | {count:सेट\|सेट} |
| `unitShort.box` | {count:box\|boxes} | {count:डिब्बा\|डिब्बे} |
| `unitShort.bag` | {count:bag\|bags} | {count:बोरी\|बोरी} |
| `unitName.kg` | Kilogram (kg) | किलो (kg) |
| `unitName.litre` | Litre (L) | लीटर (L) |
| `unitName.piece` | Piece (pcs) | नग (pcs) |
| `unitName.metre` | Metre (m) | मीटर (m) |
| `unitName.set` | Set | सेट |
| `unitName.box` | Box | डिब्बा |
| `unitName.bag` | Bag | बोरी |
| `countedIn` | {category}, counted in {unit} | {category}, {unit} में गिनती |
| `openItem` | Open {item} | {item} खोलें |
| `qtyOf` | {qty} {unit} of {item} | {item}: {qty} {unit} |
| `form.item` | Item | सामान |
| `form.itemPlaceholder` | Search store items | स्टोर का सामान खोजें |
| `form.itemRequired` | Choose an item. | सामान चुनें। |
| `form.inStoreNow` | In store now | अभी स्टोर में |
| `form.quantity` | Quantity | मात्रा |
| `form.quantityHint` | In store: {qty} {unit} | स्टोर में: {qty} {unit} |
| `form.oldOut` | Old going out | पुराना जो बाहर जा रहा है |
| `form.newIn` | New coming in | नया जो आ रहा है |
| `form.purpose` | What is it for | किस काम के लिए |
| `form.purposeRequired` | Choose what it is for. | किस काम के लिए है, चुनें। |
| `form.ref` | Cast, die or job | कास्ट, die या जॉब |
| `form.refHint` | Optional. A cast number, die or job card. | ज़रूरी नहीं। कास्ट नंबर, die या जॉब कार्ड। |
| `form.challan` | Challan or bill number | चालान या बिल नंबर |
| `form.challanHint` | Optional. From the vendor's paper. | ज़रूरी नहीं। वेंडर के कागज़ से। |
| `form.note` | Note | नोट |
| `form.noteHint` | Optional. | ज़रूरी नहीं। |
| `form.qty.empty` | Enter the quantity. | मात्रा लिखें। |
| `form.qty.invalid` | Enter a number like 12 or 12.5. | 12 या 12.5 जैसा नंबर लिखें। |
| `form.qty.zero` | The quantity must be more than 0. | मात्रा 0 से ज़्यादा होनी चाहिए। |
| `form.qty.decimals` | Use at most 3 digits after the point. | दशमलव के बाद ज़्यादा से ज़्यादा 3 अंक लिखें। |
| `form.qty.whole` | This item is counted in whole numbers. | यह सामान पूरे नग में गिना जाता है। |
| `form.qty.tooBig` | One entry can hold at most 1,00,000. Split it into two entries. | एक एंट्री में ज़्यादा से ज़्यादा 1,00,000 आ सकता है। इसे दो एंट्री में बांटें। |
| `form.qty.short` | Only {qty} {unit} in the store. Issue less, or receive the delivery first. | स्टोर में सिर्फ़ {qty} {unit} है। कम दें, या पहले डिलीवरी लें। |
| `form.failed` | Not saved. {reason} | सेव नहीं हुआ। {reason} |
| `form.unknownOutcome` | orrn didn't confirm this save, so it may have gone through. Tap {action} again to check: the same entry is never saved twice. | orrn ने इस सेव की पुष्टि नहीं की, हो सकता है यह सेव हो गया हो। जांचने के लिए फिर से {action} दबाएं, एक ही एंट्री दो बार सेव नहीं होती। |
| `form.backToStore` | Back to store | स्टोर पर वापस |
| `form.notInList` | Not in the list? | लिस्ट में नहीं है? |
| `form.allItems` | Items | सामान |
| `form.emptyHint` | Empty. Receive it first. | खाली है। पहले माल लें। |
| `errors.duplicateName` | An item in use already has this name. Use another name, or open that item. | इस नाम का सामान पहले से चालू है। दूसरा नाम रखें, या वह सामान खोलें। |
| `errors.requestReused` | This entry changed while it was being saved. Check the register, then enter it again. | सेव होते समय यह एंट्री बदल गई। रजिस्टर देखें, फिर से दर्ज करें। |
| `errors.short` | The store has less than this now. Check what is in the store and change the quantity. | स्टोर में अब इससे कम है। स्टोर में कितना है देखें और मात्रा बदलें। |
| `errors.retireWithStock` | Only an empty item can be retired. Issue what is left, or cancel its entries, first. | सिर्फ़ खाली सामान बंद हो सकता है। पहले बचा हुआ माल दें, या उसकी एंट्री रद्द करें। |
| `errors.unitLocked` | The unit can't change: this item already has entries. | इकाई नहीं बदल सकती: इस सामान की एंट्री हो चुकी है। |
| `errors.cancelDrawn` | This entry can't be cancelled: some of what it brought in has been issued since. Cancel those issues first. | यह एंट्री रद्द नहीं हो सकती: इससे आया माल बाद में दिया जा चुका है। पहले वे एंट्री रद्द करें। |
| `errors.cancelItemRetired` | This item is retired. Bring it back into use first, then cancel the entry. | यह सामान बंद है। पहले इसे फिर से चालू करें, फिर एंट्री रद्द करें। |
| `errors.cancelLocationRetired` | The store location of this entry is retired. Ask your manager or admin to bring it back, then cancel the entry. | इस एंट्री की स्टोर लोकेशन बंद है। मैनेजर या एडमिन से उसे चालू करवाएं, फिर एंट्री रद्द करें। |
| `errors.alreadyCancelled` | This entry is already cancelled. | यह एंट्री पहले ही रद्द हो चुकी है। |
| `errors.sourceLocked` | This entry belongs to another record, such as a melt. Cancel it there. | यह एंट्री दूसरे रिकॉर्ड की है, जैसे मेल्ट। उसे वहीं रद्द करें। |
| `errors.itemRetired` | This item is retired. Bring it back into use in Store items first. | यह सामान बंद है। पहले स्टोर का सामान में इसे फिर से चालू करें। |
| `errors.itemChanged` | This item was changed meanwhile. Open it again. | इस बीच यह सामान बदल गया। इसे फिर से खोलें। |
| `errors.storeChanged` | The store changed while saving. Try again. | सेव होते समय स्टोर बदल गया। फिर से कोशिश करें। |
| `errors.noLocation` | The central store is not set up yet. Ask your manager or admin to add a location of the kind Store. | सेंट्रल स्टोर अभी बना नहीं है। मैनेजर या एडमिन से Store किस्म की लोकेशन जुड़वाएं। |
| `errors.manyStores` | There is more than one store location. Ask your manager or admin to retire the extra ones. | एक से ज़्यादा स्टोर लोकेशन हैं। मैनेजर या एडमिन से फालतू वाली बंद करवाएं। |
| `errors.nameInvalid` | Use letters or digits in the name. | नाम में अक्षर या अंक लिखें। |
| `errors.notFound` | This item or entry is not here any more. Go back to the store and pick it again. | यह सामान या एंट्री अब यहां नहीं है। स्टोर पर वापस जाकर फिर से चुनें। |
| `errors.refused` | The store did not accept this. Check the entry and try again. | स्टोर ने यह नहीं लिया। एंट्री जांचें और फिर से कोशिश करें। |
| `receive.title` | Receive into store | स्टोर में माल लें |
| `receive.subtitle` | Record a delivery. It gets a GRN number. | डिलीवरी दर्ज करें। इसे GRN नंबर मिलेगा। |
| `receive.submit` | Receive | माल लें |
| `receive.done` | Received | माल आ गया |
| `receive.again` | Receive another | और माल लें |
| `issue.title` | Issue from store | स्टोर से माल दें |
| `issue.subtitle` | Give items to the floor. It gets an MRS number. | फ़्लोर को सामान दें। इसे MRS नंबर मिलेगा। |
| `issue.submit` | Issue | माल दें |
| `issue.done` | Issued | माल दे दिया |
| `issue.again` | Issue another | और माल दें |
| `exchange.title` | Exchange old for new | पुराना देकर नया लें |
| `exchange.subtitle` | The old part leaves the store and the new one comes in. It gets an MRS and a GRN number. | पुराना पार्ट स्टोर से बाहर जाता है और नया अंदर आता है। इसे MRS और GRN नंबर मिलेंगे। |
| `exchange.submit` | Exchange | बदलें |
| `exchange.done` | Exchanged | बदल गया |
| `exchange.again` | Exchange another | और बदलें |
| `exchange.newInUnder` | New part in under {number} | नया पार्ट {number} से आया |
| `replayCancelled.title` | Already cancelled | पहले ही रद्द |
| `replayCancelled.body` | {number} was saved earlier and has since been cancelled, so nothing moved now. Enter it again if it is still needed. | {number} पहले सेव हुआ था और बाद में रद्द हो गया, इसलिए अभी कुछ नहीं बदला। ज़रूरत हो तो फिर से दर्ज करें। |
| `entry.item` | Item | सामान |
| `entry.quantity` | Quantity | मात्रा |
| `entry.when` | When | कब |
| `entry.purpose` | For | किसके लिए |
| `entry.ref` | Cast, die or job | कास्ट, die या जॉब |
| `entry.challan` | Challan or bill | चालान या बिल |
| `entry.note` | Note | नोट |
| `entry.exchangedWith` | Exchange, with {number} | बदली, {number} के साथ |
| `entry.cancelledBecause` | Cancelled: {reason} | रद्द: {reason} |
| `entry.cancel` | Cancel entry | एंट्री रद्द करें |
| `entry.keep` | Keep entry | एंट्री रहने दें |
| `entry.reason` | Why cancel it | क्यों रद्द कर रहे हैं |
| `entry.reasonHint` | For example: wrong quantity typed. | जैसे: गलत मात्रा लिख दी। |
| `entry.reasonRequired` | Write why you are cancelling it. | रद्द करने की वजह लिखें। |
| `entry.cancelBoth` | Both sides of this exchange are cancelled together. | इस बदली की दोनों एंट्री एक साथ रद्द होंगी। |
| `entry.cancelEffect` | The number stays in the register, marked cancelled, and the store goes back to what it was. | नंबर रजिस्टर में रद्द लिखकर रहेगा, और स्टोर पहले जैसा हो जाएगा। |
| `entry.cancelledToast` | {number} cancelled | {number} रद्द हो गया |
| `entry.open` | Open {number} | {number} खोलें |
| `entry.belongsTo` | This entry belongs to another record ({source}). Cancel that record to undo it. | यह एंट्री दूसरे रिकॉर्ड ({source}) की है। इसे वापस लेने के लिए वह रिकॉर्ड रद्द करें। |
| `entry.challanRef` | Challan {ref} | चालान {ref} |
| `entry.period` | Financial year | वित्त वर्ष |
| `itemPage.notFound` | Store item not found | स्टोर का सामान नहीं मिला |
| `itemPage.notFoundBody` | It may belong to another plant. Go back to the store and pick it again. | यह शायद किसी दूसरे प्लांट का है। स्टोर पर वापस जाकर फिर से चुनें। |
| `itemPage.edit` | Edit item | सामान बदलें |
| `itemPage.retiredNote` | This item is retired. It can't be received or issued. | यह सामान बंद है। इसे न लिया जा सकता है, न दिया जा सकता है। |
| `itemsPage.subtitle` | Everything the store keeps, with its unit and category. | स्टोर में रखा हर सामान, उसकी इकाई और किस्म के साथ। |
| `itemsPage.show` | Show | दिखाएं |
| `itemsPage.showInUse` | In use | चालू |
| `itemsPage.showRetired` | Retired | बंद |
| `itemsPage.showAll` | All | सब |
| `itemsPage.noRetired` | No retired items | कोई बंद सामान नहीं है |
| `itemsPage.noneInUse` | No items in use | कोई सामान चालू नहीं है |
| `itemsPage.noneInUseBody` | Every item is retired. Choose Retired to see them and bring one back. | हर सामान बंद है। उन्हें देखने और फिर से चालू करने के लिए बंद चुनें। |
| `itemForm.addTitle` | Add store item | स्टोर का सामान जोड़ें |
| `itemForm.editTitle` | Edit store item | स्टोर का सामान बदलें |
| `itemForm.name` | Name | नाम |
| `itemForm.nameHint` | As the storekeeper calls it, for example Cover flux. | जैसा स्टोरकीपर बोलता है, जैसे Cover flux। |
| `itemForm.nameRequired` | Enter the item name. | सामान का नाम लिखें। |
| `itemForm.unit` | Unit | इकाई |
| `itemForm.unitHint` | The unit can't change after the item's first entry. | पहली एंट्री के बाद इकाई नहीं बदल सकती। |
| `itemForm.category` | Category | किस्म |
| `itemForm.save` | Save item | सामान सेव करें |
| `itemForm.added` | {name} added | {name} जुड़ गया |
| `itemForm.saved` | {name} saved | {name} सेव हो गया |
| `itemForm.retire` | Retire item | सामान बंद करें |
| `itemForm.restore` | Bring back into use | फिर से चालू करें |
| `itemForm.retireHint` | Retired items can't be received or issued. Only an empty item can be retired. | बंद सामान न लिया जा सकता है, न दिया जा सकता है। सिर्फ़ खाली सामान बंद हो सकता है। |
| `itemForm.retired` | {name} retired | {name} बंद हो गया |
| `itemForm.restored` | {name} is back in use | {name} फिर से चालू है |
| `itemForm.retireBlocked` | {qty} {unit} is still in the store. Issue it or cancel its entries before retiring the item. | स्टोर में अभी {qty} {unit} है। सामान बंद करने से पहले इसे दें या इसकी एंट्री रद्द करें। |

### printing (82)

| Key | English | हिंदी |
|---|---|---|
| `title` | Printing | प्रिंटिंग |
| `tabs.queue` | Queue | कतार |
| `tabs.printers` | Printers | प्रिंटर |
| `tabs.labels` | Labels | लेबल |
| `queue.empty` | Nothing waiting to print. | प्रिंट के लिए कुछ बाकी नहीं है। |
| `queue.label` | Label | लेबल |
| `queue.printer` | Printer | प्रिंटर |
| `queue.status` | Status | स्टेटस |
| `queue.when` | When | कब |
| `queue.error` | Error | गड़बड़ी |
| `queue.retry` | Retry | फिर से भेजें |
| `queue.cancel` | Cancel job | जॉब कैंसल करें |
| `queue.retried` | Sent again | फिर से भेज दिया |
| `printers.empty` | No printers connected yet. | अभी कोई प्रिंटर नहीं जुड़ा है। |
| `printers.name` | Printer | प्रिंटर |
| `printers.status` | Status | स्टेटस |
| `printers.lastSeen` | Last seen {time} | आखिरी बार {time} पर दिखा |
| `labels.push` | Send label design to printers | लेबल डिज़ाइन प्रिंटर को भेजें |
| `labels.pushed` | Label design sent | लेबल डिज़ाइन भेज दिया |
| `advanced.title` | Advanced | एडवांस |
| `advanced.variables` | Label data (JSON) | लेबल डेटा (JSON) |
| `advanced.submit` | Send print job | प्रिंट जॉब भेजें |
| `notSetUpTitle` | Label printing isn't set up | लेबल प्रिंटिंग सेट नहीं है |
| `notSetUpBody` | Ask the orrn team to set up label printing for your plant. | अपने प्लांट के लिए लेबल प्रिंटिंग सेट करवाने के लिए orrn टीम से कहें। |
| `restricted` | You can see the queue. Ask a manager to change printers or labels. | आप कतार देख सकते हैं। प्रिंटर या लेबल बदलने के लिए मैनेजर से कहें। |
| `subtitle` | Labels waiting to print, and the print computers at your plant. | प्रिंट होने के लिए रुके लेबल और आपके प्लांट के प्रिंट कंप्यूटर। |
| `loadFailed` | Couldn't load printing. Check your connection and try again. | प्रिंटिंग लोड नहीं हुई। कनेक्शन देखकर फिर कोशिश करें। |
| `queueExtra.all` | All | सभी |
| `queueExtra.emptyFiltered` | No jobs with this status. | इस स्टेटस का कोई जॉब नहीं है। |
| `queueExtra.noReason` | No reason was recorded. | कोई वजह दर्ज नहीं हुई। |
| `queueExtra.attempt` | Attempt {n} | कोशिश {n} |
| `queueExtra.retryFor` | Send label {label} again | लेबल {label} फिर से भेजें |
| `queueExtra.retryFailed` | Couldn't send it again. Try once more, or see how to fix the printer. | फिर से नहीं भेज सके। एक बार और कोशिश करें, या प्रिंटर ठीक करने का तरीका देखें। |
| `queueExtra.noBundle` | No bundle | कोई bundle नहीं |
| `queueExtra.summary` | {failed} failed, {waiting} waiting | {failed} फ़ेल, {waiting} इंतज़ार में |
| `queueExtra.summaryClear` | Nothing failed or waiting. | कुछ भी फ़ेल या इंतज़ार में नहीं है। |
| `queueExtra.filterLabel` | Show jobs | जॉब दिखाएं |
| `nodes.title` | Print computers | प्रिंट कंप्यूटर |
| `nodes.hint` | Shows when each print computer last reported in. Whether a printer has paper or ribbon is not reported here. | हर प्रिंट कंप्यूटर ने आखिरी बार कब रिपोर्ट किया, यह दिखता है। प्रिंटर में कागज़ या रिबन है या नहीं, यह यहाँ नहीं बताया जाता। |
| `nodes.neverSeen` | Has not reported in yet | अभी तक रिपोर्ट नहीं आई |
| `nodes.version` | Version {version} | वर्ज़न {version} |
| `nodes.lastError` | Last error: {message} | आखिरी गड़बड़ी: {message} |
| `nodes.site` | Site: {site} | जगह: {site} |
| `nodes.profiles` | Label printers | लेबल प्रिंटर |
| `nodes.profilesEmpty` | No label printer is set up yet. | अभी कोई लेबल प्रिंटर सेट नहीं है। |
| `nodes.copies` | {count} {count:copy\|copies} per label | हर लेबल की {count} {count:कॉपी\|कॉपियाँ} |
| `nodes.template` | Label design: {name} | लेबल डिज़ाइन: {name} |
| `reprint.title` | Reprint a label | लेबल दोबारा प्रिंट करें |
| `reprint.body` | Enter the bundle number. orrn opens the bundle, where Reprint label sends the label to the printer. | Bundle नंबर लिखें। orrn bundle खोलता है, वहाँ "लेबल दोबारा प्रिंट" से लेबल प्रिंटर को जाता है। |
| `reprint.field` | Bundle number | Bundle नंबर |
| `reprint.open` | Open bundle | Bundle खोलें |
| `reprint.required` | Enter a bundle number. | Bundle नंबर लिखें। |
| `designs.title` | Label designs | लेबल डिज़ाइन |
| `designs.empty` | No label design yet. | अभी कोई लेबल डिज़ाइन नहीं है। |
| `designs.sent` | Sent {time} | {time} पर भेजा |
| `designs.notSent` | Not sent to the print computer yet | प्रिंट कंप्यूटर को अभी नहीं भेजा |
| `designs.pushFailed` | Couldn't send the label design. Check that the print computer is connected. | लेबल डिज़ाइन नहीं भेज सके। देखें कि प्रिंट कंप्यूटर जुड़ा है। |
| `scale.title` | Scale | कांटा |
| `scale.connected` | Sending weights | वज़न आ रहा है |
| `scale.idle` | No weight coming in | वज़न नहीं आ रहा |
| `scale.none` | No scale | कांटा नहीं |
| `scale.unknown` | Not reported | बताया नहीं गया |
| `scale.configured` | Set up | लगा हुआ |
| `scale.simulated` | Simulated | नकली |
| `scale.lastFrame` | Last weight read {time} | आखिरी वज़न {time} पर पढ़ा |
| `scale.noFrame` | No recent reading when this computer last reported ({time}). | इस कंप्यूटर की आखिरी रिपोर्ट ({time}) पर कोई ताज़ा रीडिंग नहीं थी। |
| `scale.noneHint` | This print computer has no scale connected. | इस प्रिंट कंप्यूटर पर कांटा नहीं जुड़ा है। |
| `scale.unknownHint` | This print computer has not said whether a scale is connected yet. | इस प्रिंट कंप्यूटर ने अभी बताया नहीं कि कांटा जुड़ा है या नहीं। |
| `collectors.title` | Press and spectro collectors | प्रेस और स्पेक्ट्रो कलेक्टर |
| `collectors.none` | This print computer runs no collector. | इस प्रिंट कंप्यूटर पर कोई कलेक्टर नहीं चल रहा। |
| `collectors.press` | Press {line} | प्रेस {line} |
| `collectors.spectro` | Spectro files | स्पेक्ट्रो फ़ाइलें |
| `collectors.sending` | Sending | भेज रहा है |
| `collectors.watching` | Watching the folder | फ़ोल्डर देख रहा है |
| `collectors.quiet` | Nothing coming in | कुछ नहीं आ रहा |
| `collectors.notConfigured` | Not set up | लगा नहीं |
| `collectors.simulated` | Simulated | नकली |
| `collectors.simulatedHint` | Simulated data: no press or spectrometer is connected to this computer. | नकली डेटा: इस कंप्यूटर से कोई प्रेस या स्पेक्ट्रोमीटर नहीं जुड़ा है। |
| `collectors.lastFrame` | Last reading {time} | आखिरी रीडिंग {time} पर |
| `collectors.noFrame` | No recent reading when this computer last reported ({time}). | इस कंप्यूटर की आखिरी रिपोर्ट ({time}) पर कोई ताज़ा रीडिंग नहीं थी। |
| `collectors.backlog` | {count} waiting to send | {count} भेजने बाकी |
| `collectors.error` | Last problem: {message} | आखिरी दिक्कत: {message} |

### settings (213)

| Key | English | हिंदी |
|---|---|---|
| `title` | Settings | सेटिंग्स |
| `subtitle` | Company, shifts, team, devices and printing for your plant. | आपके प्लांट की कंपनी, शिफ्ट, टीम, डिवाइस और प्रिंटिंग। |
| `loadFailed` | Couldn't load settings. Check your connection and try again. | सेटिंग्स लोड नहीं हुईं। कनेक्शन देखकर फिर कोशिश करें। |
| `tabs.company` | Company | कंपनी |
| `tabs.team` | Team | टीम |
| `tabs.shifts` | Shifts | शिफ्ट |
| `tabs.standards` | Standards | स्टैंडर्ड |
| `tabs.modules` | Modules | मॉड्यूल |
| `tabs.devices` | Devices | डिवाइस |
| `tabs.backup` | Backup | बैकअप |
| `tabs.support` | Help | मदद |
| `tabs.about` | About | जानकारी |
| `tabs.printing` | Printing | प्रिंटिंग |
| `tabs.data` | Data | डेटा |
| `company.name` | Company name | कंपनी का नाम |
| `company.nameHint` | Only orrn support can change this. | इसे सिर्फ़ orrn सपोर्ट बदल सकता है। |
| `company.lengthUnit` | Length unit | लंबाई की इकाई |
| `company.unitMm` | Millimetres (mm) | मिलीमीटर (mm) |
| `company.unitInch` | Feet and inches | फ़ुट और इंच |
| `company.timezone` | Time zone | टाइम ज़ोन |
| `company.submit` | Save settings | सेटिंग्स सेव करें |
| `company.saved` | Settings saved | सेटिंग्स सेव हो गईं |
| `company.readOnly` | Only owners and admins can change these. | इन्हें सिर्फ़ मालिक और एडमिन बदल सकते हैं। |
| `company.profile` | Company | कंपनी |
| `company.slug` | Short name | छोटा नाम |
| `company.units` | Units | इकाइयाँ |
| `company.unitsHint` | Pack and stock screens show lengths in this unit. Weights are always in kg. | Pack और स्टॉक स्क्रीन पर लंबाई इसी इकाई में दिखती है। वज़न हमेशा kg में रहता है। |
| `company.timezoneHint` | Days and shifts follow this time zone. | दिन और शिफ़्ट इसी टाइम ज़ोन से चलते हैं। |
| `company.language` | Language | भाषा |
| `company.languageHint` | English and हिंदी are available. The choice is kept on this device. | English और हिंदी उपलब्ध हैं। चुनी हुई भाषा इसी डिवाइस पर रहती है। |
| `company.saveFailed` | Couldn't save the settings. Try again. | सेटिंग्स सेव नहीं हुईं। फिर कोशिश करें। |
| `company.letterheadHint` | Printed at the top of packing lists and test certificates. | पैकिंग लिस्ट और टेस्ट सर्टिफिकेट के ऊपर छपता है। |
| `company.letterheadSubmit` | Save letterhead | लेटरहेड सेव करें |
| `company.letterheadSaved` | Letterhead saved | लेटरहेड सेव हो गया |
| `company.gstinInvalid` | GSTIN is 15 letters and digits. | GSTIN में 15 अक्षर और अंक होते हैं। |
| `team.members` | Members | सदस्य |
| `team.invite` | Invite member | सदस्य को इनवाइट करें |
| `team.inviteTitle` | Invite a team member | टीम में किसी को इनवाइट करें |
| `team.email` | Email | ईमेल |
| `team.role` | Role | रोल |
| `team.roleHints.owner` | Everything, including team and company settings. | सब कुछ, टीम और कंपनी सेटिंग्स समेत। |
| `team.roleHints.admin` | Everything, including team and company settings. | सब कुछ, टीम और कंपनी सेटिंग्स समेत। |
| `team.roleHints.manager` | Dies, customers, dispatches and printers. No team or settings. | Die, ग्राहक, dispatch और प्रिंटर। टीम या सेटिंग्स नहीं। |
| `team.roleHints.office` | Orders, dispatches, scrap weighing, D/C notes, Tally export and reports. | ऑर्डर, dispatch, स्क्रैप का वज़न, D/C नोट, Tally export और रिपोर्ट। |
| `team.roleHints.accountant` | Reads orders, invoices and D/C notes. GST and Tally export. Can belong to several plants. | ऑर्डर, बिल और D/C नोट देखना। GST और Tally export। कई प्लांट में हो सकते हैं। |
| `team.roleHints.supervisor` | Packing, stock, dispatch, casts, press runs, quality checks and ageing. Voids bundles. | पैकिंग, स्टॉक, dispatch, कास्ट, प्रेस रन, क्वालिटी जाँच और एजिंग। Bundle रद्द करना। |
| `team.roleHints.packer` | Packs bundles and prints labels, moves and counts stock, scans onto packing lists. | Bundle पैक करना और लेबल प्रिंट करना, स्टॉक की जगह बदलना और गिनना, packing list पर स्कैन करना। |
| `team.roleHints.foundry` | Cast entry and spectro. Approves cast close-outs. | कास्ट एंट्री और स्पेक्ट्रो। कास्ट क्लोज़ को मंज़ूरी देना। |
| `team.roleHints.press` | Press runs, die weight readings, quality checks and ageing. | प्रेस रन, die वज़न रीडिंग, क्वालिटी जाँच और एजिंग। |
| `team.roleHints.storekeeper` | Scrap weighing, and items issued from or returned to the store. | स्क्रैप का वज़न, और स्टोर से सामान देना और वापस लेना। |
| `team.roleHints.die_room` | Die cards, nitriding, die weight readings. Proposes tier changes. | Die कार्ड, नाइट्राइडिंग, die वज़न रीडिंग। टियर बदलने का प्रस्ताव। |
| `team.roleHints.operator` | Packs bundles, scans into dispatches, voids bundles and prints labels. | Bundle पैक करना, dispatch में स्कैन करना, bundle रद्द करना और लेबल प्रिंट करना। |
| `team.roleHints.viewer` | Can see everything. Can't change anything. | सब कुछ देख सकते हैं, कुछ बदल नहीं सकते। |
| `team.sendInvite` | Send invite | इनवाइट भेजें |
| `team.inviteSent` | Invite sent to {email} | {email} को इनवाइट भेज दिया |
| `team.pending` | Pending invites | बाकी इनवाइट |
| `team.expires` | Link works until {date} | लिंक {date} तक चलेगा |
| `team.revoke` | Cancel invite | इनवाइट कैंसल करें |
| `team.revoked` | Invite cancelled | इनवाइट कैंसल हो गया |
| `team.changeRole` | Change role | रोल बदलें |
| `team.roleChanged` | Role changed | रोल बदल गया |
| `team.remove` | Remove from team | टीम से हटाएं |
| `team.removeTitle` | Remove {name}? | {name} को हटाएं? |
| `team.removeBody` | They lose access to this company straight away. | इस कंपनी में उनका एक्सेस तुरंत बंद हो जाएगा। |
| `team.removed` | {name} removed | {name} को हटा दिया |
| `team.ownerLocked` | Only an owner can change another owner. | मालिक का रोल सिर्फ़ दूसरा मालिक बदल सकता है। |
| `team.you` | You | आप |
| `team.name` | Name | नाम |
| `team.joined` | Joined | कब जुड़े |
| `team.empty` | No members yet. | अभी कोई सदस्य नहीं है। |
| `team.pendingEmpty` | No invites waiting. | कोई इनवाइट बाकी नहीं है। |
| `team.expired` | Expired | खत्म हो गया |
| `team.inviteFailed` | Couldn't send the invite. Check the email and try again. | इनवाइट नहीं भेज सके। ईमेल देखकर फिर कोशिश करें। |
| `team.loadFailed` | Couldn't load the team. Try again. | टीम लोड नहीं हुई। फिर कोशिश करें। |
| `team.readOnly` | Only owners and admins can invite people. | इनवाइट सिर्फ़ मालिक और एडमिन भेज सकते हैं। |
| `team.linkColumn` | Invite link | इनवाइट लिंक |
| `team.actions` | Actions | कार्रवाई |
| `team.changeRoleTitle` | Change role for {name} | {name} की भूमिका बदलें |
| `team.saveRole` | Save role | भूमिका सेव करें |
| `team.roleFailed` | Couldn't change the role. Try again. | भूमिका नहीं बदली। फिर कोशिश करें। |
| `team.removeFailed` | Couldn't remove this person. Try again. | इन्हें हटाया नहीं जा सका। फिर कोशिश करें। |
| `team.removeConfirm` | Remove | हटाएं |
| `team.portalTitle` | Party portal logins | पार्टी पोर्टल लॉगिन |
| `team.portalBody` | No party has a login yet. Parties with a login see their orders, dispatches and certificates at /portal. | अभी किसी पार्टी का लॉगिन नहीं है। लॉगिन वाली पार्टियां अपने ऑर्डर, डिस्पैच और सर्टिफ़िकेट /portal पर देखती हैं। |
| `shifts.intro` | Shift 1 starts the production day. A bundle packed before that time counts for the day before. | शिफ्ट 1 से प्रोडक्शन का दिन शुरू होता है। उस समय से पहले पैक हुआ bundle पिछले दिन का गिना जाता है। |
| `shifts.startsDay` | Shift 1, {name}, starts the production day at {time}. | शिफ्ट 1, {name}, {time} पर प्रोडक्शन का दिन शुरू करती है। |
| `shifts.position` | Shift {seq} | शिफ्ट {seq} |
| `shifts.remove` | Remove shift {name} | शिफ्ट {name} हटाएं |
| `shifts.applies` | A change applies from the next read. A press run that is open keeps the shift it started in. | बदलाव अगली बार पढ़ने से लागू होता है। चल रहा प्रेस रन अपनी शुरू वाली शिफ्ट में ही रहता है। |
| `shifts.covered` | The shifts cover 24 hours with no overlap. Touching ends are fine. | शिफ्ट पूरे 24 घंटे ढकती हैं, दोहरा समय नहीं है। जुड़े हुए सिरे ठीक हैं। |
| `shifts.save` | Save shifts | शिफ्ट सेव करें |
| `shifts.saved` | Shifts saved | शिफ्ट सेव हो गईं |
| `shifts.saveFailed` | Couldn't save the shifts. Try again. | शिफ्ट सेव नहीं हुईं। फिर कोशिश करें। |
| `shifts.notSaved` | Not saved | सेव नहीं हुआ |
| `shifts.undo` | Undo changes | बदलाव वापस लें |
| `shifts.readOnly` | Only owners and admins can change shifts. | शिफ्ट सिर्फ़ मालिक और एडमिन बदल सकते हैं। |
| `shifts.nowIn` | Now: {name} | अभी: {name} |
| `standards.intro` | Printed on the label and the test certificate for the die's profile kind. A blank CM/L prints no licence line. | डाई के प्रोफ़ाइल प्रकार के हिसाब से लेबल और टेस्ट सर्टिफिकेट पर छपता है। CM/L खाली हो तो लाइसेंस की लाइन नहीं छपती। |
| `standards.designationHint` | Up to 40 characters. | ज़्यादा से ज़्यादा 40 अक्षर। |
| `standards.cmlHint` | Blank prints no licence line. | खाली हो तो लाइसेंस की लाइन नहीं छपती। |
| `standards.semiSolid` | Left blank, semi hollow prints the solid designation and licence. | खाली छोड़ें तो सेमी हॉलो पर सॉलिड वाला स्टैंडर्ड और लाइसेंस छपेगा। |
| `standards.save` | Save standards | स्टैंडर्ड सेव करें |
| `standards.saved` | Standards saved | स्टैंडर्ड सेव हो गए |
| `standards.saveFailed` | Couldn't save the standards. Try again. | स्टैंडर्ड सेव नहीं हुए। फिर कोशिश करें। |
| `standards.readOnly` | Only owners and admins can change standards. | स्टैंडर्ड सिर्फ़ मालिक और एडमिन बदल सकते हैं। |
| `thresholds.title` | Thresholds | सीमाएं |
| `thresholds.intro` | The limits the screens colour by. Type a percent. A change applies from the next request. | स्क्रीन इन सीमाओं से रंग तय करती हैं। प्रतिशत में लिखें। बदलाव अगले अनुरोध से लागू होता है। |
| `thresholds.readOnly` | Only owners and admins can change thresholds. | सीमाएं सिर्फ़ मालिक और एडमिन बदल सकते हैं। |
| `thresholds.drift` | Die weight drift | Die वज़न का ड्रिफ्ट |
| `thresholds.driftHint` | How far a bundle sits above its band start. Up to the green limit is green, up to the amber limit is amber, above that is red. | बंडल अपने बैंड की शुरुआत से कितना ऊपर है। हरी सीमा तक हरा, अंबर सीमा तक अंबर, उसके ऊपर लाल। |
| `thresholds.driftGreen` | Green up to (%) | हरा यहां तक (%) |
| `thresholds.driftAmber` | Amber up to (%) | अंबर यहां तक (%) |
| `thresholds.recovery` | Press recovery | प्रेस रिकवरी |
| `thresholds.recoveryHint` | Good kg as a share of billet kg on the press report. Leave both blank for no colour. | प्रेस रिपोर्ट में बिलेट kg का कितना हिस्सा अच्छा kg है। रंग न चाहिए तो दोनों खाली छोड़ें। |
| `thresholds.recoveryGreen` | Green from (%) | हरा यहां से (%) |
| `thresholds.recoveryAmber` | Amber from (%) | अंबर यहां से (%) |
| `thresholds.recoveryNone` | No colour | कोई रंग नहीं |
| `thresholds.recoveryValue` | green {green}, amber {amber} | हरा {green}, अंबर {amber} |
| `thresholds.balance` | Press balance warning | प्रेस बैलेंस चेतावनी |
| `thresholds.balanceHint` | A run whose unaccounted kg is above this share of its billet kg is flagged when it closes. | जिस रन का बिना हिसाब का kg उसके बिलेट kg के इस हिस्से से ऊपर हो, बंद होते समय उस पर निशान लगता है। |
| `thresholds.balanceWarn` | Warn above (%) | इससे ऊपर चेतावनी (%) |
| `thresholds.save` | Save thresholds | सीमाएं सेव करें |
| `thresholds.saved` | Thresholds saved | सीमाएं सेव हो गईं |
| `thresholds.saveFailed` | Couldn't save the thresholds. Try again. | सीमाएं सेव नहीं हुईं। फिर कोशिश करें। |
| `thresholds.errors.number` | Enter a number from 0 to 100, with up to two decimals. | 0 से 100 के बीच संख्या लिखें, दशमलव के दो अंक तक। |
| `thresholds.errors.driftOrder` | Green must be below amber. | हरी सीमा अंबर से नीचे होनी चाहिए। |
| `thresholds.errors.recoveryOrder` | Amber must be below green. | अंबर सीमा हरी से नीचे होनी चाहिए। |
| `thresholds.errors.recoveryBoth` | Fill both recovery limits, or leave both blank. | रिकवरी की दोनों सीमाएं भरें, या दोनों खाली छोड़ें। |
| `modules.bought` | Bought modules | खरीदे हुए मॉड्यूल |
| `modules.boughtHint` | orrn support turns modules on or off. Ask them to add or remove one. | मॉड्यूल orrn सपोर्ट चालू या बंद करता है। जोड़ने या हटाने के लिए उन्हें कहें। |
| `modules.allOn` | Every module is on. | सभी मॉड्यूल चालू हैं। |
| `modules.moduleOff` | {name}, off | {name}, बंद |
| `modules.switches` | Switches | स्विच |
| `modules.switchesHint` | A switch applies from the next request. | स्विच अगले अनुरोध से लागू होता है। |
| `modules.on` | On | चालू |
| `modules.off` | Off | बंद |
| `modules.dieBands` | Die bands | Die बैंड |
| `modules.dieBandsHint` | Off hides the band and the band-start basis. The stored grams are not rewritten. | बंद करने पर बैंड और बैंड-शुरुआत वाला आधार छिप जाता है। सेव ग्राम नहीं बदलते। |
| `modules.priceOnSalesOrder` | Price on the sales order | सेल्स ऑर्डर पर कीमत |
| `modules.priceOnSalesOrderHint` | On shows the rate per kg to staff who hold the price action. The party portal never shows a rate. | चालू हो तो कीमत वाली कार्रवाई वाले स्टाफ़ को प्रति kg रेट दिखता है। पार्टी पोर्टल पर रेट कभी नहीं दिखता। |
| `modules.dieRequired` | Die required on order lines | ऑर्डर लाइन पर die ज़रूरी |
| `modules.dieRequiredHint` | On: confirming an order needs a die copy or a tier. Off: it may go ahead on the section alone. | चालू: ऑर्डर पक्का करने के लिए die कॉपी या टियर चाहिए। बंद: सिर्फ़ सेक्शन पर भी आगे बढ़ सकता है। |
| `modules.portalEnabled` | Party portal | पार्टी पोर्टल |
| `modules.portalEnabledHint` | Parties with a login see their orders, dispatches and certificates at /portal. | लॉगिन वाली पार्टियां अपने ऑर्डर, डिस्पैच और सर्टिफ़िकेट /portal पर देखती हैं। |
| `modules.requireCast` | Cast number on bundles | Bundle पर कास्ट नंबर |
| `modules.requireCastHint` | Automatic turns it on after the first locked melt. | ऑटोमैटिक में पहली लॉक हुई मेल्ट के बाद चालू हो जाता है। |
| `modules.castAuto` | Automatic | ऑटोमैटिक |
| `modules.saved` | Saved | सेव हो गया |
| `modules.saveFailed` | Couldn't save the switch. Try again. | स्विच सेव नहीं हुआ। फिर कोशिश करें। |
| `modules.readOnly` | Only owners and admins can change the switches. | स्विच सिर्फ़ मालिक और एडमिन बदल सकते हैं। |
| `modules.lastChange` | Last change: {who}, {when}. From {from} to {to}. | आखिरी बदलाव: {who}, {when}। {from} से {to}। |
| `modules.noChange` | No change recorded yet. | अभी तक कोई बदलाव दर्ज नहीं। |
| `about.app` | App | ऐप |
| `about.version` | Web app version | वेब ऐप का वर्शन |
| `about.plant` | Plant | प्लांट |
| `about.signedIn` | Signed in as | साइन इन |
| `about.role` | Your role | आपकी भूमिका |
| `about.support` | Support | सपोर्ट |
| `about.supportNone` | No support contact is set for your plant. Use Help to reach the orrn team. | आपके प्लांट के लिए सपोर्ट संपर्क सेट नहीं है। orrn टीम तक पहुंचने के लिए मदद इस्तेमाल करें। |
| `about.hoursLabel` | Hours | समय |
| `about.supportEditTitle` | Your support contact | आपका सपोर्ट संपर्क |
| `about.supportEditHint` | Everyone at your plant sees this. Put the person to call when something goes wrong. | प्लांट में सबको यह दिखता है। कुछ गड़बड़ हो तो जिसे फ़ोन करना है, उसका नाम लिखें। |
| `about.supportName` | Contact name | संपर्क का नाम |
| `about.supportPhone` | Phone | फ़ोन |
| `about.supportHours` | Hours | समय |
| `about.supportSave` | Save contact | संपर्क सेव करें |
| `about.supportSaved` | Contact saved | संपर्क सेव हो गया |
| `about.supportSaveFailed` | Couldn't save the contact. Try again. | संपर्क सेव नहीं हुआ। फिर कोशिश करें। |
| `about.help` | Open Help | मदद खोलें |
| `about.guides` | Guides | गाइड |
| `about.releaseNotes` | What changed | क्या बदला |
| `about.releaseNotesHint` | The last app builds and what each one changed. The same text the app shows when it asks for an update. | ऐप के पिछले बिल्ड और हर एक में क्या बदला। यही लिखावट ऐप अपडेट माँगते समय दिखाता है। |
| `about.releaseNotesNone` | No app builds have been published yet. | अभी तक कोई ऐप बिल्ड जारी नहीं हुआ। |
| `about.releaseBuild` | {platform} {version} (build {build}) | {platform} {version} (बिल्ड {build}) |
| `about.releaseMandatory` | Update required | अपडेट ज़रूरी |
| `about.platformName.android` | Android | Android |
| `about.platformName.ios` | iPhone | iPhone |
| `about.platformName.web` | Web | वेब |
| `printing.packingList.title` | What one packing list carries | एक packing list में क्या जाएगा |
| `printing.packingList.hint` | How a dispatch is built. Changing it does not touch dispatches already started. | dispatch कैसे बनता है। बदलने से शुरू हो चुके dispatch पर असर नहीं पड़ता। |
| `printing.packingList.failed` | Could not save the setting. Try again. | सेटिंग सेव नहीं हुई। फिर कोशिश करें। |
| `printing.packingList.readOnly` | Set by the plant's owner or admin. | प्लांट के owner या admin तय करते हैं। |
| `printing.packingList.scope.one_so.label` | One order | एक ऑर्डर |
| `printing.packingList.scope.one_so.body` | Each packing list is for one sales order. A dispatch starts from the order and takes that order's bundles only. | हर packing list एक सेल्स ऑर्डर की होती है। dispatch ऑर्डर से शुरू होता है और उसी ऑर्डर के bundle लेता है। |
| `printing.packingList.scope.one_customer.label` | One customer | एक ग्राहक |
| `printing.packingList.scope.one_customer.body` | Each packing list is for one customer. Lines from several of that customer's orders can go on it. | हर packing list एक ग्राहक की होती है। उसमें उस ग्राहक के कई ऑर्डर की लाइनें आ सकती हैं। |
| `printing.packingList.scope.per_truck.label` | Several per truck | ट्रक में कई |
| `printing.packingList.scope.per_truck.body` | One truck can carry several customers. Each customer has its own packing list, all under the same vehicle. | एक ट्रक में कई ग्राहक जा सकते हैं। हर ग्राहक की अपनी packing list होती है, सब एक ही गाड़ी के नीचे। |
| `printing.status` | Label printing | लेबल प्रिंटिंग |
| `printing.printers` | Printers | प्रिंटर |
| `printing.lastSeen` | Last report from the print computer: {time} | प्रिंट कंप्यूटर की आखिरी रिपोर्ट: {time} |
| `printing.neverSeen` | The print computer has not reported in yet. | प्रिंट कंप्यूटर ने अभी तक रिपोर्ट नहीं की। |
| `printing.defaults` | Label defaults | लेबल की डिफ़ॉल्ट सेटिंग |
| `printing.defaultsEmpty` | No label printer is set up yet. | अभी कोई लेबल प्रिंटर सेट नहीं है। |
| `printing.copies` | {count} {count:copy\|copies} per label | हर लेबल की {count} {count:कॉपी\|कॉपियाँ} |
| `printing.template` | Label design: {name} | लेबल डिज़ाइन: {name} |
| `printing.open` | Open printing | प्रिंटिंग खोलें |
| `printing.hint` | Printers and label designs are set up by the orrn team. | प्रिंटर और लेबल डिज़ाइन orrn टीम सेट करती है। |
| `data.title` | Data | डेटा |
| `data.importBundles` | Import old bundles | पुराने bundle इम्पोर्ट करें |
| `data.importDies` | Import dies | Die इम्पोर्ट करें |
| `data.importCustomers` | Import customers | ग्राहक इम्पोर्ट करें |
| `data.hint` | Upload an Excel or CSV file. orrn checks every row before saving anything. | Excel या CSV फ़ाइल अपलोड करें। कुछ भी सेव करने से पहले orrn हर लाइन जांचता है। |
| `data.chooseFile` | Choose file | फ़ाइल चुनें |
| `data.rowsOk` | {count} {count:row\|rows} ready | {count} लाइन तैयार |
| `data.rowsRejected` | {count} {count:row\|rows} with problems | {count} लाइन में दिक्कत |
| `data.rowProblem` | Row {row}: {reason} | लाइन {row}: {reason} |
| `data.submit` | Import {count} {count:row\|rows} | {count} लाइन इम्पोर्ट करें |
| `data.imported` | {count} {count:row\|rows} imported | {count} लाइन इम्पोर्ट हो {count:गई\|गईं} |
| `data.bundlesBody` | Stock on your shelves from before orrn. Dies not in orrn yet are added for you. | orrn से पहले से रैक पर रखा स्टॉक। जो die orrn में नहीं हैं, वे अपने आप जुड़ जाते हैं। |
| `data.diesBody` | Series, section code and the weight range per 12 ft. | Series, section code और 12 ft का वज़न रेंज। |
| `data.customersBody` | Names, phone numbers, email and GSTIN. | नाम, फ़ोन नंबर, ईमेल और GSTIN। |
| `data.noAccess` | Your role can't import data. Ask an owner or admin if you need it. | आपके रोल से डेटा इम्पोर्ट नहीं होता। ज़रूरत हो तो owner या admin से कहें। |

### imports (122)

| Key | English | हिंदी |
|---|---|---|
| `title.bundles` | Import old bundles | पुराने bundle इम्पोर्ट करें |
| `title.dies` | Import dies | Die इम्पोर्ट करें |
| `title.customers` | Import customers | ग्राहक इम्पोर्ट करें |
| `about.bundles` | Bundles already on your shelves from before orrn. | orrn से पहले से रैक पर रखे bundle। |
| `about.dies` | Your die list, with the weight range per 12 ft. | आपकी die लिस्ट, 12 ft के वज़न रेंज के साथ। |
| `about.customers` | Customer names, phone numbers, email and GSTIN. | ग्राहकों के नाम, फ़ोन नंबर, ईमेल और GSTIN। |
| `drop.title` | Drop a CSV or Excel file here | CSV या Excel फ़ाइल यहां छोड़ें |
| `drop.or` | or | या |
| `drop.choose` | Choose file | फ़ाइल चुनें |
| `drop.types` | CSV or Excel (.csv, .xlsx, .xls) | CSV या Excel (.csv, .xlsx, .xls) |
| `drop.dragging` | Drop to read this file | यह फ़ाइल पढ़ने के लिए छोड़ें |
| `drop.titleTouch` | Choose a CSV or Excel file | CSV या Excel फ़ाइल चुनें |
| `columns.heading` | Columns orrn reads | orrn ये कॉलम पढ़ता है |
| `columns.required` | Needed | ज़रूरी |
| `columns.optional` | Optional | चाहें तो |
| `columns.unitRule` | Put the unit in the column name: Length (mm), Length (in), Length (ft), Weight (kg) or Weight (g). | कॉलम के नाम में यूनिट लिखें: Length (mm), Length (in), Length (ft), Weight (kg) या Weight (g)। |
| `columns.lengthFallbackMm` | A length column with no unit is read in mm, your company setting. | बिना यूनिट वाला length कॉलम mm में पढ़ा जाता है, जो आपकी कंपनी की सेटिंग है। |
| `columns.lengthFallbackInch` | A length column with no unit is read in inches, your company setting. 11 ft 6 in also works. | बिना यूनिट वाला length कॉलम इंच में पढ़ा जाता है, जो आपकी कंपनी की सेटिंग है। 11 ft 6 in भी चलता है। |
| `columns.weightFallback` | A weight column with no unit is read in kg. | बिना यूनिट वाला weight कॉलम kg में पढ़ा जाता है। |
| `columns.sample` | Download sample sheet | सैंपल शीट डाउनलोड करें |
| `legacyDies` | Dies not in orrn yet are added for you, marked legacy. Check their weight range on the Dies page afterwards. | जो die orrn में नहीं हैं, वे legacy निशान के साथ अपने आप जुड़ते हैं। बाद में Dies पेज पर उनका वज़न रेंज जांच लें। |
| `reading` | Reading {name} | {name} पढ़ रहे हैं |
| `checking` | Checking these dies against orrn | ये die orrn से मिला रहे हैं |
| `readFailed` | orrn couldn't read this file. Save it as CSV or Excel (.xlsx) and choose it again. | orrn यह फ़ाइल नहीं पढ़ पाया। इसे CSV या Excel (.xlsx) में सेव करके फिर चुनें। |
| `wrongType` | This is not a CSV or Excel file. Choose a .csv, .xlsx or .xls file. | यह CSV या Excel फ़ाइल नहीं है। .csv, .xlsx या .xls फ़ाइल चुनें। |
| `noRows` | This file has no rows under the header row. Add rows and choose it again. | इस फ़ाइल में हेडर के नीचे कोई लाइन नहीं है। लाइनें जोड़कर फिर चुनें। |
| `tooManyRows` | This file has {count} rows. orrn takes up to {max} at a time. Split it into smaller files. | इस फ़ाइल में {count} लाइनें हैं। orrn एक बार में {max} तक लेता है। इसे छोटी फ़ाइलों में बांटें। |
| `tooBig` | This file is larger than {size}. Split it into smaller files. | यह फ़ाइल {size} से बड़ी है। इसे छोटी फ़ाइलों में बांटें। |
| `missingTitle` | Columns missing | कॉलम नहीं मिले |
| `missingBody` | Add {count:this column\|these columns} to the sheet and choose it again: | शीट में {count:यह कॉलम\|ये कॉलम} जोड़ें और फिर चुनें: |
| `conflictTitle` | Two columns fill the same field | दो कॉलम एक ही चीज़ भरते हैं |
| `conflictBody` | orrn can't tell which one is right. Remove one column from each pair and choose the file again: | orrn नहीं बता सकता कि कौन सा सही है। हर जोड़ी में से एक कॉलम हटाएं और फ़ाइल फिर चुनें: |
| `conflictItem` | {field}: {columns} | {field}: {columns} |
| `chooseAnother` | Choose another file | दूसरी फ़ाइल चुनें |
| `ready` | Ready to import | इम्पोर्ट के लिए तैयार |
| `problems` | Need fixing | ठीक करनी हैं |
| `rows` | {count:row\|rows} | {count:लाइन\|लाइन} |
| `readAs.heading` | How orrn read your columns | orrn ने आपके कॉलम ऐसे पढ़े |
| `readAs.plain` | {field} | {field} |
| `readAs.same` | Used as it is | जैसा है वैसा लिया |
| `readAs.unit` | {field} in {unit} | {field}, {unit} में |
| `readAs.fallback` | {field} in {unit}, from your company setting | {field}, {unit} में, आपकी कंपनी की सेटिंग से |
| `readAs.notUsed` | Not used: {columns} | इस्तेमाल नहीं हुए: {columns} |
| `readAs.badUnit` | Not used, the unit is not clear: {columns}. Name the unit, like Length (mm) or Weight (kg). | इस्तेमाल नहीं हुए, यूनिट साफ़ नहीं है: {columns}। यूनिट लिखें, जैसे Length (mm) या Weight (kg)। |
| `readAs.perTwelve` | {field} in kg per 12 ft | {field}, kg प्रति 12 ft में |
| `unit.mm` | mm | mm |
| `unit.in` | inches | इंच |
| `unit.ft` | feet | फ़ुट |
| `unit.kg` | kg | kg |
| `unit.g` | grams | ग्राम |
| `unit.m` | metres | मीटर |
| `preview.heading` | First rows, as orrn will save them | पहली लाइनें, जैसे orrn सेव करेगा |
| `preview.row` | Row | लाइन |
| `problemList` | Rows with problems | दिक्कत वाली लाइनें |
| `problemMore` | {count} more. Download the rows to see them all. | {count} और। सब देखने के लिए लाइनें डाउनलोड करें। |
| `downloadProblems` | Download rows with problems | दिक्कत वाली लाइनें डाउनलोड करें |
| `problemColumn` | Problem | दिक्कत |
| `existing.title` | {count} {count:die is\|dies are} already in orrn | {count} die पहले से orrn में {count:है\|हैं} |
| `existing.label` | Dies already in orrn | जो die पहले से orrn में हैं |
| `existing.skip` | Leave as they are | जैसे हैं वैसे रहने दें |
| `existing.update` | Update from this sheet | इस शीट से अपडेट करें |
| `existing.help` | Only the columns in this sheet change. Empty cells, and columns the sheet doesn't have, keep what orrn has. | सिर्फ़ इस शीट के कॉलम बदलते हैं। खाली सेल और जो कॉलम शीट में नहीं हैं, उनमें orrn का डेटा वैसा ही रहता है। |
| `nothingReady` | No rows are ready to import. Fix the rows with problems and choose the file again. | कोई लाइन इम्पोर्ट के लिए तैयार नहीं है। दिक्कत वाली लाइनें ठीक करके फ़ाइल फिर चुनें। |
| `saving` | Saving {done} of {total} rows | {total} में से {done} लाइन सेव हुईं |
| `keepOpen` | Keep this open until it finishes. | पूरा होने तक इसे खुला रखें। |
| `done` | Imported | इम्पोर्ट हो गया |
| `newDies` | {count} new {count:die\|dies} added, marked legacy. Check {count:its\|their} weight range on the Dies page. | {count} नई die legacy निशान के साथ {count:जुड़ी\|जुड़ीं}। Dies पेज पर वज़न रेंज जांच लें। |
| `failed.server` | orrn's server ran into a problem. | orrn के सर्वर में दिक्कत आई। |
| `failed.busy` | orrn is busy right now. Wait a moment, then try again. | orrn अभी व्यस्त है। थोड़ी देर रुककर फिर कोशिश करें। |
| `failed.refused` | orrn did not accept these rows. | orrn ने ये लाइनें नहीं लीं। |
| `failed.savedUpTo` | Saved {done} of {total} rows, up to row {row}. | {total} में से {done} लाइन सेव हुईं, लाइन {row} तक। |
| `failed.nothingSaved` | No rows were saved. | कोई लाइन सेव नहीं हुई। |
| `failed.unknown` | orrn can't tell yet if {count} {count:row\|rows} from row {from} to row {to} {count:was\|were} saved. | orrn अभी पक्का नहीं बता सकता कि लाइन {from} से लाइन {to} तक की {count} लाइन सेव हुईं या नहीं। |
| `failed.unknownHelp` | Try again: rows that were already saved are not added twice. | फिर कोशिश करें: जो लाइनें सेव हो चुकी हैं, वे दोबारा नहीं जुड़ेंगी। |
| `failed.refusedRows` | Nothing from row {from} on was saved. | लाइन {from} से आगे कुछ सेव नहीं हुआ। |
| `failed.refusedHelp` | Download the rows not saved, fix them and import that file. Don't import this whole file again. | जो लाइनें सेव नहीं हुईं, उन्हें डाउनलोड करें, ठीक करें और वही फ़ाइल इम्पोर्ट करें। यह पूरी फ़ाइल दोबारा इम्पोर्ट न करें। |
| `confirmClose.title` | Close this import? | यह इम्पोर्ट बंद करें? |
| `confirmClose.unknown` | {count} {count:row is\|rows are} not saved for sure. To finish later, choose this same file again without changing it: rows already saved are skipped. | {count} लाइन पक्का सेव नहीं {count:हुई\|हुईं}। बाद में पूरा करने के लिए यही फ़ाइल बिना बदले फिर चुनें: जो लाइनें सेव हो चुकी हैं, वे छोड़ दी जाएंगी। |
| `confirmClose.refused` | {count} {count:row was\|rows were} not saved. Download {count:it\|them} first, so you can fix {count:it\|them} and import only {count:that row\|those rows}. | {count} लाइन सेव नहीं {count:हुई\|हुईं}। पहले {count:उसे\|उन्हें} डाउनलोड करें, ताकि ठीक करके सिर्फ़ {count:वही लाइन\|वही लाइनें} इम्पोर्ट कर सकें। |
| `confirmClose.keepOpen` | Keep open | खुला रखें |
| `confirmClose.close` | Close anyway | फिर भी बंद करें |
| `already` | {count} {count:row was\|rows were} already in orrn from an earlier import of this sheet, so {count:it was\|they were} not added again. To add {count:it\|them} again after deleting {count:it\|them} in orrn, change a value in the sheet. | {count} लाइन इसी शीट के पिछले इम्पोर्ट से पहले से orrn में {count:थी\|थीं}, इसलिए दोबारा नहीं जोड़ी {count:गई\|गईं}। orrn में डिलीट करने के बाद {count:उसे\|उन्हें} फिर जोड़ना हो तो शीट में कोई एक वैल्यू बदल दें। |
| `doneProblemsHelp` | Fix the downloaded rows and import only that file. Don't import this whole file again. | डाउनलोड की गई लाइनें ठीक करें और सिर्फ़ वही फ़ाइल इम्पोर्ट करें। यह पूरी फ़ाइल दोबारा इम्पोर्ट न करें। |
| `alreadyTitle` | Already imported | पहले से इम्पोर्ट है |
| `diesDone` | {created} new {created:die\|dies}, {updated} updated. | {created} नई die, {updated} अपडेट हुईं। |
| `retry` | Try the rest again | बाकी फिर से भेजें |
| `downloadUnsaved` | Download rows not saved | जो लाइनें सेव नहीं हुईं, डाउनलोड करें |
| `field.dieSeries` | Die series | Die series |
| `field.dieSectionCode` | Section code | Section code |
| `field.quantity` | Pieces | पीस |
| `field.weight` | Weight | वज़न |
| `field.length` | Length | लंबाई |
| `field.poNumber` | PO number | PO नंबर |
| `field.series` | Series | Series |
| `field.sectionCode` | Section code | Section code |
| `field.name` | Name | नाम |
| `field.weightMin` | Min weight | कम से कम वज़न |
| `field.weightMax` | Max weight | ज़्यादा से ज़्यादा वज़न |
| `field.width` | Width | चौड़ाई |
| `field.height` | Height | ऊंचाई |
| `field.thickness` | Thickness | मोटाई |
| `field.oblique` | Oblique | Oblique |
| `field.leg` | Leg | Leg |
| `field.status` | Status | स्टेटस |
| `field.notes` | Notes | नोट |
| `field.phone` | Phone | फ़ोन |
| `field.email` | Email | ईमेल |
| `field.taxId` | GSTIN | GSTIN |
| `reason.blank` | {column} is empty. | {column} खाली है। |
| `reason.notNumber` | {column} is not a plain number. Use a point for decimals, like 45.5. | {column} सादा नंबर नहीं है। दशमलव के लिए पॉइंट लिखें, जैसे 45.5। |
| `reason.notWhole` | {column} must be a whole number. | {column} पूरा नंबर होना चाहिए। |
| `reason.notPositive` | {column} must be more than 0. | {column} 0 से ज़्यादा होना चाहिए। |
| `reason.tooLong` | {column} is longer than {max} characters. | {column} {max} अक्षरों से लंबा है। |
| `reason.badEmail` | {column} is not an email address. | {column} ईमेल पता नहीं है। |
| `reason.badStatus` | {column} must be active or archived. | {column} active या archived होना चाहिए। |
| `reason.rangeOrder` | Max weight is less than min weight. | ज़्यादा से ज़्यादा वज़न, कम से कम वज़न से कम है। |
| `reason.duplicate` | Same die as row {other}. | लाइन {other} वाली die ही है। |
| `reason.deletedDie` | A deleted die already uses this section code. Use a different code for this die. | यह section code एक डिलीट की गई die का है। इस die के लिए दूसरा कोड लिखें। |
| `reason.dieDeleted` | This die was deleted in orrn, so bundles can't be added to it. | यह die orrn में डिलीट हो चुकी है, इसलिए इसमें bundle नहीं जुड़ सकते। |
| `reason.lengthRange` | {column} reads as {length}, too long or too short for a bundle. Check the unit in the column name. | {column} {length} पढ़ा गया, जो bundle के लिए बहुत लंबा या बहुत छोटा है। कॉलम के नाम में यूनिट जांचें। |
| `reason.weightRange` | {column} reads as {weight}, too heavy to be right. Check the unit in the column name. | {column} {weight} पढ़ा गया, जो सही होने के लिए बहुत ज़्यादा है। कॉलम के नाम में यूनिट जांचें। |
| `reason.alreadyImported` | This row (same row number, same values) was already imported from an earlier copy of this file, so it is not added again. | यह लाइन (वही लाइन नंबर, वही वैल्यू) इस फ़ाइल की पहले की कॉपी से इम्पोर्ट हो चुकी है, इसलिए दोबारा नहीं जोड़ी गई। |

### masters (244)

| Key | English | हिंदी |
|---|---|---|
| `reasons.title` | Reason codes | कारण कोड |
| `reasons.subtitle` | Why a press stopped, a bundle was voided or a label was printed again. These are the choices people pick from. | प्रेस क्यों रुका, बंडल क्यों रद्द हुआ या लेबल दोबारा क्यों छपा। लोग इन्हीं में से चुनते हैं। |
| `reasons.kindsLabel` | Kind of reason | कारण का प्रकार |
| `reasons.add` | Add reason | कारण जोड़ें |
| `reasons.columns.label` | Reason | कारण |
| `reasons.columns.key` | Key | कोड |
| `reasons.columns.hindi` | Hindi | हिंदी |
| `reasons.columns.gujarati` | Gujarati | गुजराती |
| `reasons.columns.note` | Note | नोट |
| `reasons.columns.status` | Status | स्थिति |
| `reasons.noteYes` | Asks for a note | नोट मांगता है |
| `reasons.noteNo` | No note | नोट नहीं |
| `reasons.fixed` | Fixed | तय |
| `reasons.fixedHint` | Other is always there, always asks for a note and always comes last. It cannot be changed. | 'अन्य' हमेशा रहता है, हमेशा नोट मांगता है और हमेशा आखिर में आता है। इसे बदला नहीं जा सकता। |
| `reasons.empty` | No reasons of this kind | इस प्रकार का कोई कारण नहीं |
| `reasons.form.addTitle` | Add a reason | कारण जोड़ें |
| `reasons.form.editTitle` | Edit {name} | {name} बदलें |
| `reasons.form.english` | English wording | अंग्रेज़ी शब्द |
| `reasons.form.englishHint` | The key is made from this when the reason is added. Renaming never changes the key. | कारण जोड़ते समय इसी से कोड बनता है। नाम बदलने पर कोड नहीं बदलता। |
| `reasons.form.hindi` | Hindi wording | हिंदी शब्द |
| `reasons.form.gujarati` | Gujarati wording | गुजराती शब्द |
| `reasons.form.translationHint` | Leave blank to use the built-in wording, or the English. | खाली छोड़ें तो बना-बनाया शब्द दिखेगा, या अंग्रेज़ी। |
| `reasons.form.note` | Ask for a note when this reason is picked | यह कारण चुनने पर नोट मांगें |
| `reasons.form.save` | Save reason | कारण सेव करें |
| `reasons.form.retireHint` | A retired reason leaves the pickers but stays on old records. | बंद किया कारण चुनने की सूची से हट जाता है, पर पुराने रिकॉर्ड में रहता है। |
| `reasons.form.labelRequired` | Give the wording. | शब्द लिखें। |
| `hub.title` | Masters | मास्टर |
| `hub.subtitle` | The lists every other screen picks from. | वे लिस्टें जिनसे बाकी सभी स्क्रीन चुनती हैं। |
| `hub.buying` | Buying and melting | खरीद और भट्टी |
| `hub.floor` | Floor and dies | फ़्लोर और die |
| `hub.vendors` | Vendors | पार्टियां |
| `hub.vendorsHint` | Who sells us scrap, and the other spellings of their names | कौन हमें स्क्रैप बेचता है, और उनके नाम के दूसरे रूप |
| `hub.vendorsNoun` | {count:vendor\|vendors} | {count:पार्टी\|पार्टियां} |
| `hub.scrap` | Scrap and returns | स्क्रैप और रिटर्न |
| `hub.scrapHint` | Scrap items and grades the yard buys, and streams the furnace takes back | यार्ड जो स्क्रैप आइटम और ग्रेड खरीदता है, और भट्टी में वापस जाने वाला माल |
| `hub.scrapNoun` | {count:item\|items} | {count:आइटम\|आइटम} |
| `hub.storeItems` | Store items | स्टोर का सामान |
| `hub.storeItemsHint` | Chemicals, gas, fuel and spares the store keeps | स्टोर में रखे केमिकल, गैस, ईंधन और स्पेयर |
| `hub.storeItemsNoun` | {count:item\|items} | {count:सामान\|सामान} |
| `hub.locations` | Locations | जगहें |
| `hub.locationsHint` | Yards and stores where stock sits | यार्ड और स्टोर जहां स्टॉक रहता है |
| `hub.locationsNoun` | {count:place\|places} | {count:जगह\|जगहें} |
| `hub.sections` | Sections | सेक्शन |
| `hub.sectionsHint` | The catalogue of sections and their weight bands | सेक्शन की लिस्ट और उनकी वज़न रेंज |
| `hub.sectionsNoun` | {count:section\|sections} | {count:सेक्शन\|सेक्शन} |
| `hub.dieCopies` | Die copies | Die कॉपी |
| `hub.dieCopiesHint` | Every physical die of every section, with its tier | हर सेक्शन की हर असली die, उसके टियर के साथ |
| `hub.dieCopiesNoun` | {count:copy\|copies} | {count:कॉपी\|कॉपी} |
| `hub.toConfirm` | Vendors to confirm | पक्की करने वाली पार्टियां |
| `hub.toConfirmMeta` | Added at the kanta. Check each name, then confirm. | कांटे पर जोड़ी गईं। हर नाम जांचें, फिर पक्का करें। |
| `hub.reasons` | Reason codes | कारण कोड |
| `hub.reasonsHint` | Why a press stopped, a bundle was voided or a label was printed again | प्रेस क्यों रुका, बंडल क्यों रद्द हुआ या लेबल दोबारा क्यों छपा |
| `hub.reasonsNoun` | {count:reason\|reasons} | {count:कारण\|कारण} |
| `hub.furnaces` | Furnaces | फर्नेस |
| `hub.furnacesHint` | The foundry's furnaces and how much one melt may hold | फाउंड्री की फर्नेस और एक मेल्ट में कितना आ सकता है |
| `hub.furnacesNoun` | {count:furnace\|furnaces} | {count:फर्नेस\|फर्नेस} |
| `hub.alloys` | Alloys | अलॉय |
| `hub.alloysHint` | The alloys cast and the element limits a spectro result is judged by | ढाले जाने वाले अलॉय और वे तत्व-सीमाएं जिनसे स्पेक्ट्रो नतीजा जाँचा जाता है |
| `hub.alloysNoun` | {count:alloy\|alloys} | {count:अलॉय\|अलॉय} |
| `show` | Show | दिखाएं |
| `showInUse` | In use | चालू |
| `showRetired` | Retired | बंद |
| `showAll` | All | सभी |
| `status.inUse` | In use | चालू |
| `status.retired` | Retired | बंद |
| `order` | Position in lists | लिस्ट में जगह |
| `orderHint` | Lower numbers come first. | छोटा नंबर पहले आता है। |
| `orderInvalid` | Use a whole number from 0 to 10,000. | 0 से 10,000 तक का पूरा नंबर डालें। |
| `retireHint` | Retired entries leave every picker but stay on old records. | बंद की गई चीज़ें किसी भी लिस्ट में चुनने को नहीं आतीं, पर पुराने रिकॉर्ड पर बनी रहती हैं। |
| `retire` | Retire | बंद करें |
| `restore` | Bring back | फिर से चालू करें |
| `edit` | Edit {name} | {name} बदलें |
| `readOnly` | Only a manager or the owner can change this list. | इस लिस्ट को सिर्फ़ मैनेजर या मालिक बदल सकते हैं। |
| `loadFailed` | The list didn't load. | लिस्ट लोड नहीं हुई। |
| `noRetired` | Nothing retired | कुछ भी बंद नहीं है |
| `noneInUse` | Nothing in use | कुछ भी चालू नहीं है |
| `noAccess` | Your role can't open this list. | आपका रोल यह लिस्ट नहीं खोल सकता। |
| `noAccessBody` | Ask a manager or the owner if you need it. | ज़रूरत हो तो मैनेजर या मालिक से पूछें। |
| `backToMasters` | Masters | मास्टर |
| `saved` | {name} saved | {name} सेव हो गया |
| `added` | {name} added | {name} जुड़ गया |
| `retired` | {name} retired | {name} बंद हो गया |
| `restored` | {name} is back in use | {name} फिर से चालू है |
| `seeded` | {count} {count:entry\|entries} added | {count} {count:चीज़\|चीज़ें} जुड़ीं |
| `seededNone` | Every standard entry is already here | सभी स्टैंडर्ड चीज़ें पहले से हैं |
| `errors.generic` | Couldn't save. Check the connection and try again. | सेव नहीं हुआ। इंटरनेट जांचें और फिर से कोशिश करें। |
| `errors.changed` | Someone changed this a moment ago. Close it, open it again and retry. | किसी ने अभी इसे बदला है। इसे बंद करके फिर खोलें और दोबारा करें। |
| `errors.forbidden` | Your role can't change this list. Ask a manager. | आपका रोल यह लिस्ट नहीं बदल सकता। मैनेजर से पूछें। |
| `errors.notFound` | This entry is gone. Reload the list. | यह चीज़ अब नहीं है। लिस्ट दोबारा लोड करें। |
| `errors.nameRequired` | Give it a name. | नाम डालें। |
| `locations.title` | Locations | जगहें |
| `locations.subtitle` | Yards and stores where stock sits. Packing, moving and counting pick from this list. | यार्ड और स्टोर जहां स्टॉक रहता है। पैकिंग, मूव और गिनती इसी लिस्ट से चुनते हैं। |
| `locations.add` | Add location | जगह जोड़ें |
| `locations.seed` | Add the plant's locations | प्लांट की जगहें जोड़ें |
| `locations.seedTitle` | Add the plant's locations? | प्लांट की जगहें जोड़ें? |
| `locations.seedBody` | This adds yards 1 to 6, the billet store, the scrap store, the central store and plant scrap, skipping any you already have. After this, packing asks which yard each bundle goes to. | इससे यार्ड 1 से 6, बिलेट स्टोर, स्क्रैप स्टोर, सेंट्रल स्टोर और प्लांट स्क्रैप जुड़ेंगे, जो पहले से हैं वे छोड़ दिए जाएंगे। इसके बाद पैकिंग में हर bundle का यार्ड पूछा जाएगा। |
| `locations.empty` | No locations yet | अभी कोई जगह नहीं है |
| `locations.emptyBody` | Add the plant's yards and stores in one go, or add your own. | प्लांट के यार्ड और स्टोर एक बार में जोड़ें, या अपनी जगहें जोड़ें। |
| `locations.columns.code` | Code | कोड |
| `locations.columns.name` | Name | नाम |
| `locations.columns.kind` | Kind | किस्म |
| `locations.columns.holds` | Holds | क्या रखा है |
| `locations.columns.status` | Status | स्टेटस |
| `locations.kind.yard` | Yard | यार्ड |
| `locations.kind.billet_store` | Billet store | बिलेट स्टोर |
| `locations.kind.scrap_store` | Scrap store | स्क्रैप स्टोर |
| `locations.kind.store` | Central store | सेंट्रल स्टोर |
| `locations.kind.wip` | Work in progress | काम चालू |
| `locations.holdsEmpty` | Empty | खाली |
| `locations.holdsBundles` | {count} {count:bundle\|bundles} | {count} bundle |
| `locations.holdsKg` | {kg} kg | {kg} kg |
| `locations.holdsItems` | {count} store {count:item\|items} | स्टोर के {count} सामान |
| `locations.form.addTitle` | Add location | जगह जोड़ें |
| `locations.form.editTitle` | Edit location {code} | जगह {code} बदलें |
| `locations.form.code` | Code | कोड |
| `locations.form.codeHint` | The short code painted at the spot. Letters, digits and dashes. | जगह पर लिखा छोटा कोड। अक्षर, अंक और डैश। |
| `locations.form.codeRequired` | Give the location a code. | जगह का कोड डालें। |
| `locations.form.codeInvalid` | Use letters, digits and dashes only, starting with a letter or digit. | सिर्फ़ अक्षर, अंक और डैश डालें, शुरुआत अक्षर या अंक से। |
| `locations.form.codeZero` | 0 is not a place. Use the real yard code. | 0 कोई जगह नहीं है। यार्ड का असली कोड डालें। |
| `locations.form.name` | Name | नाम |
| `locations.form.nameRequired` | Give the location a name. | जगह का नाम डालें। |
| `locations.form.kind` | Kind | किस्म |
| `locations.form.kindHint` | Bundles go only to yards. The kind changes only while the location is empty. | Bundle सिर्फ़ यार्ड में जाते हैं। किस्म तभी बदलती है जब जगह खाली हो। |
| `locations.form.save` | Save location | जगह सेव करें |
| `locations.form.retire` | Retire location | जगह बंद करें |
| `locations.form.retireHint` | A retired location leaves every picker. Only an empty location can be retired. | बंद जगह किसी लिस्ट में नहीं आती। सिर्फ़ खाली जगह बंद हो सकती है। |
| `locations.errors.codeTaken` | Location {code} already exists. Use another code. | जगह {code} पहले से है। दूसरा कोड डालें। |
| `locations.errors.notEmpty` | Location {code} still holds stock. Move it out first, then try again. | जगह {code} में अभी स्टॉक है। पहले उसे हटाएं, फिर कोशिश करें। |
| `scrap.title` | Scrap and returns | स्क्रैप और रिटर्न |
| `scrap.subtitle` | What the yard buys, and what the furnace takes back. | यार्ड क्या खरीदता है, और भट्टी में क्या वापस जाता है। |
| `scrap.tabs.label` | Lists | लिस्टें |
| `scrap.tabs.items` | Scrap items | स्क्रैप आइटम |
| `scrap.tabs.grades` | Grades | ग्रेड |
| `scrap.tabs.streams` | Return streams | रिटर्न स्ट्रीम |
| `scrap.seed` | Add the standard grades and items | स्टैंडर्ड ग्रेड और आइटम जोड़ें |
| `scrap.items.add` | Add scrap item | स्क्रैप आइटम जोड़ें |
| `scrap.items.empty` | No scrap items yet | अभी कोई स्क्रैप आइटम नहीं है |
| `scrap.items.emptyBody` | Add the purchase book's items and the standard grades in one go, or add your own. | खरीद बुक के आइटम और स्टैंडर्ड ग्रेड एक बार में जोड़ें, या अपने जोड़ें। |
| `scrap.items.columns.name` | Item | आइटम |
| `scrap.items.columns.recovery` | Expected recovery | अनुमानित रिकवरी |
| `scrap.items.columns.status` | Status | स्टेटस |
| `scrap.grades.add` | Add grade | ग्रेड जोड़ें |
| `scrap.grades.empty` | No grades yet | अभी कोई ग्रेड नहीं है |
| `scrap.grades.emptyBody` | Add the standard grades A+, A, B and C with the purchase book's items, or add your own. | खरीद बुक के आइटम के साथ स्टैंडर्ड ग्रेड A+, A, B और C जोड़ें, या अपने जोड़ें। |
| `scrap.grades.columns.code` | Grade | ग्रेड |
| `scrap.grades.columns.name` | Description | मतलब |
| `scrap.grades.columns.recovery` | Expected recovery | अनुमानित रिकवरी |
| `scrap.grades.columns.status` | Status | स्टेटस |
| `scrap.form.itemAddTitle` | Add scrap item | स्क्रैप आइटम जोड़ें |
| `scrap.form.itemEditTitle` | Edit scrap item | स्क्रैप आइटम बदलें |
| `scrap.form.gradeAddTitle` | Add grade | ग्रेड जोड़ें |
| `scrap.form.gradeEditTitle` | Edit grade {code} | ग्रेड {code} बदलें |
| `scrap.form.name` | Name | नाम |
| `scrap.form.nameHint` | As the purchase book writes it. | जैसा खरीद बुक में लिखा जाता है। |
| `scrap.form.recovery` | Expected recovery (%) | अनुमानित रिकवरी (%) |
| `scrap.form.recoveryHint` | Metal you expect back from 100 kg of it. Leave blank if you don't know yet. | 100 kg में से कितना मेटल वापस मिलने की उम्मीद है। पता न हो तो खाली छोड़ें। |
| `scrap.form.recoveryInvalid` | Use a number from 0 to 100, with at most two decimals. | 0 से 100 तक का नंबर डालें, दशमलव के बाद ज़्यादा से ज़्यादा दो अंक। |
| `scrap.form.gradeCode` | Grade | ग्रेड |
| `scrap.form.gradeCodeHint` | Up to 8 letters, digits, + or -, like A+. | 8 तक अक्षर, अंक, + या -, जैसे A+। |
| `scrap.form.gradeCodeRequired` | Give the grade a code. | ग्रेड का कोड डालें। |
| `scrap.form.gradeCodeInvalid` | Use up to 8 letters, digits, + or -. | 8 तक अक्षर, अंक, + या - डालें। |
| `scrap.form.gradeCodeFixed` | The grade itself stays as it is: lots already carry it. | ग्रेड का कोड नहीं बदलता: लॉट पर पहले से लिखा है। |
| `scrap.form.gradeName` | Description | मतलब |
| `scrap.form.gradeNameHint` | Optional. What this grade means at the kanta. | चाहें तो। कांटे पर इस ग्रेड का क्या मतलब है। |
| `scrap.form.save` | Save | सेव करें |
| `scrap.errors.itemTaken` | That scrap item is already in the list. | यह स्क्रैप आइटम लिस्ट में पहले से है। |
| `scrap.errors.gradeTaken` | That grade is already in the list. | यह ग्रेड लिस्ट में पहले से है। |
| `streams.add` | Add return stream | रिटर्न स्ट्रीम जोड़ें |
| `streams.seed` | Add the foundry's streams | भट्टी की स्ट्रीम जोड़ें |
| `streams.empty` | No return streams yet | अभी कोई रिटर्न स्ट्रीम नहीं है |
| `streams.emptyBody` | Add the streams from the foundry sheet in one go, or add your own. | भट्टी की शीट वाली स्ट्रीम एक बार में जोड़ें, या अपनी जोड़ें। |
| `streams.columns.code` | Code | कोड |
| `streams.columns.name` | Name | नाम |
| `streams.columns.kind` | Kind | किस्म |
| `streams.columns.balance` | On hand | अभी कितना |
| `streams.columns.status` | Status | स्टेटस |
| `streams.kind.charge` | Goes back in | भट्टी में वापस |
| `streams.kind.byproduct` | By-product | बाय-प्रोडक्ट |
| `streams.form.addTitle` | Add return stream | रिटर्न स्ट्रीम जोड़ें |
| `streams.form.editTitle` | Edit return stream {code} | रिटर्न स्ट्रीम {code} बदलें |
| `streams.form.code` | Code | कोड |
| `streams.form.codeHint` | Letters, digits and dashes. It can't change later. | अक्षर, अंक और डैश। बाद में नहीं बदलेगा। |
| `streams.form.codeRequired` | Give the stream a code. | स्ट्रीम का कोड डालें। |
| `streams.form.codeInvalid` | Use up to 20 letters, digits and dashes. | 20 तक अक्षर, अंक और डैश डालें। |
| `streams.form.codeFixed` | The code and kind stay as they are: the stock book uses them. | कोड और किस्म नहीं बदलते: स्टॉक बुक इन्हें इस्तेमाल करती है। |
| `streams.form.name` | Name | नाम |
| `streams.form.kind` | Kind | किस्म |
| `streams.form.kindHint` | Goes back in: the furnace melts it again. By-product: it leaves the melt, like dross. | भट्टी में वापस: भट्टी इसे फिर से पिघलाती है। बाय-प्रोडक्ट: पिघलाने में अलग निकलता है, जैसे ड्रॉस। |
| `streams.form.save` | Save stream | स्ट्रीम सेव करें |
| `streams.errors.taken` | A return stream with that code or name is already in the list. | इस कोड या नाम की रिटर्न स्ट्रीम लिस्ट में पहले से है। |
| `dieCopies.title` | Die copies | Die कॉपी |
| `dieCopies.subtitle` | Every physical die of every section: its tier, status and latest weight. | हर सेक्शन की हर असली die: उसका टियर, स्टेटस और ताज़ा वज़न। |
| `dieCopies.add` | Add die copy | Die कॉपी जोड़ें |
| `dieCopies.empty` | No die copies yet | अभी कोई die कॉपी नहीं है |
| `dieCopies.emptyBody` | Add the first copy of a section. Its code is the section code and a number, like 12170-1. | किसी सेक्शन की पहली कॉपी जोड़ें। उसका कोड सेक्शन कोड और एक नंबर होता है, जैसे 12170-1। |
| `dieCopies.emptyFiltered` | No copies match these filters | इन फ़िल्टर से कोई कॉपी नहीं मिली |
| `dieCopies.filters.section` | Section | सेक्शन |
| `dieCopies.filters.sectionPlaceholder` | All sections | सभी सेक्शन |
| `dieCopies.filters.status` | Status | स्टेटस |
| `dieCopies.filters.allStatuses` | Every status | हर स्टेटस |
| `dieCopies.filters.clear` | Clear filters | फ़िल्टर हटाएं |
| `dieCopies.columns.copy` | Copy | कॉपी |
| `dieCopies.columns.section` | Section | सेक्शन |
| `dieCopies.columns.tier` | Tier | टियर |
| `dieCopies.columns.latest` | Latest kg/12ft | ताज़ा kg/12ft |
| `dieCopies.columns.supplier` | Supplier | सप्लायर |
| `dieCopies.columns.status` | Status | स्टेटस |
| `dieCopies.tier` | Tier {rank} | टियर {rank} |
| `dieCopies.notRanked` | Not ranked | टियर नहीं |
| `dieCopies.noReading` | No reading | रीडिंग नहीं |
| `dieCopies.status.available` | Ready | तैयार |
| `dieCopies.status.in_use` | On the press | प्रेस पर |
| `dieCopies.status.at_nitriding` | At nitriding | नाइट्राइडिंग में |
| `dieCopies.status.at_maker` | At die maker | Die मेकर के पास |
| `dieCopies.status.on_trial` | On trial | ट्रायल पर |
| `dieCopies.status.retired` | Retired | बंद |
| `dieCopies.openSection` | Open section {code} | सेक्शन {code} खोलें |
| `dieCopies.form.addTitle` | Add die copy | Die कॉपी जोड़ें |
| `dieCopies.form.editTitle` | Edit {code} | {code} बदलें |
| `dieCopies.form.section` | Section | सेक्शन |
| `dieCopies.form.sectionPlaceholder` | Search sections | सेक्शन खोजें |
| `dieCopies.form.sectionRequired` | Choose the section this die makes. | यह die कौन सा सेक्शन बनाती है, चुनें। |
| `dieCopies.form.sectionFixed` | Section {code}. The section and the copy number never change. | सेक्शन {code}। सेक्शन और कॉपी नंबर कभी नहीं बदलते। |
| `dieCopies.form.supplier` | Supplier | सप्लायर |
| `dieCopies.form.trial` | Trial kg/12ft | ट्रायल kg/12ft |
| `dieCopies.form.trialHint` | Weight per 12 ft from the trial run. | ट्रायल रन में 12 ft का वज़न। |
| `dieCopies.form.trialInvalid` | Use a weight above 0 and up to 500, with at most three decimals. | 0 से ऊपर और 500 तक का वज़न डालें, दशमलव के बाद ज़्यादा से ज़्यादा तीन अंक। |
| `dieCopies.form.hardness` | Hardness | हार्डनेस |
| `dieCopies.form.hardnessHint` | As tested. A whole number. | जांच में आई। पूरा नंबर। |
| `dieCopies.form.hardnessInvalid` | Use a whole number from 1 to 5,000. | 1 से 5,000 तक का पूरा नंबर डालें। |
| `dieCopies.form.life` | Expected life (kg) | अनुमानित लाइफ़ (kg) |
| `dieCopies.form.lifeHint` | Kg this die should press before it is retired. | बंद करने से पहले यह die कितने kg प्रेस करे। |
| `dieCopies.form.lifeInvalid` | Use a whole number of kg, above 0. | kg का पूरा नंबर डालें, 0 से ऊपर। |
| `dieCopies.form.ftr` | FTR | FTR |
| `dieCopies.form.ftrHint` | As written on the die card. | जैसा die कार्ड पर लिखा है। |
| `dieCopies.form.tier` | First tier | पहला टियर |
| `dieCopies.form.tierHint` | Only when you add the copy. Later changes go to a manager for approval. | सिर्फ़ कॉपी जोड़ते समय। बाद में बदलाव मैनेजर की मंज़ूरी से होता है। |
| `dieCopies.form.tierInvalid` | Use a whole number from 1 to 99. | 1 से 99 तक का पूरा नंबर डालें। |
| `dieCopies.form.tierLocked` | Tier changes are proposed from the die room and approved by a manager. | टियर का बदलाव die रूम से भेजा जाता है और मैनेजर मंज़ूर करते हैं। |
| `dieCopies.form.status` | Status | स्टेटस |
| `dieCopies.form.notes` | Notes | नोट |
| `dieCopies.form.save` | Save die copy | Die कॉपी सेव करें |
| `dieCopies.form.added` | Die copy {code} added | Die कॉपी {code} जुड़ गई |
| `dieCopies.errors.sectionArchived` | That section is archived. Bring it back before adding copies. | यह सेक्शन बंद है। कॉपी जोड़ने से पहले इसे फिर से चालू करें। |

### vendors (116)

| Key | English | हिंदी |
|---|---|---|
| `title` | Vendors | पार्टियां |
| `subtitle` | Who sells us scrap. Lots, rates and D/C notes hang off these names. | कौन हमें स्क्रैप बेचता है। लॉट, रेट और D/C नोट इन्हीं नामों से जुड़े हैं। |
| `add` | Add vendor | पार्टी जोड़ें |
| `merge` | Merge vendors | पार्टियां मिलाएं |
| `search` | Search vendors | पार्टी खोजें |
| `searchHint` | Finds other spellings too. | दूसरे नामों से भी मिलती है। |
| `show` | Show | दिखाएं |
| `showAll` | All | सभी |
| `showDraft` | To confirm | पक्की करनी हैं |
| `showArchived` | Archived | बंद |
| `showMerged` | Merged | मिलाई गईं |
| `columns.vendor` | Vendor | पार्टी |
| `columns.gstin` | GSTIN | GSTIN |
| `columns.city` | City | शहर |
| `columns.lastLot` | Last lot | आखिरी लॉट |
| `columns.status` | Status | स्टेटस |
| `unregistered` | Unregistered | बिना रजिस्ट्रेशन |
| `noLots` | No lots yet | अभी कोई लॉट नहीं |
| `empty` | No vendors yet | अभी कोई पार्टी नहीं है |
| `emptyBody` | Add the people you buy scrap from. The yard can also add one at the kanta. | जिनसे आप स्क्रैप खरीदते हैं उन्हें जोड़ें। यार्ड भी कांटे पर पार्टी जोड़ सकता है। |
| `emptyDraft` | Nothing to confirm | पक्का करने को कुछ नहीं |
| `emptyArchived` | No archived vendors | कोई बंद पार्टी नहीं |
| `emptyMerged` | No merged vendors | कोई मिलाई गई पार्टी नहीं |
| `status.active` | Active | चालू |
| `status.draft` | To confirm | पक्की करनी है |
| `status.archived` | Archived | बंद |
| `status.merged` | Merged | मिलाई गई |
| `toConfirm` | {count} {count:vendor\|vendors} to confirm | {count} {count:पार्टी\|पार्टियां} पक्की करनी हैं |
| `toConfirmBody` | The yard added these at the kanta. Check each name and GSTIN, then confirm. | यार्ड ने इन्हें कांटे पर जोड़ा है। हर नाम और GSTIN जांचें, फिर पक्का करें। |
| `showThem` | Show them | इन्हें दिखाएं |
| `noAccess` | Vendors are for the yard, the office and managers. | पार्टियां यार्ड, ऑफ़िस और मैनेजर के लिए हैं। |
| `noAccessBody` | Rates are private. Ask a manager if you need this list. | रेट प्राइवेट हैं। ज़रूरत हो तो मैनेजर से पूछें। |
| `page.details` | Details | जानकारी |
| `page.gstin` | GSTIN | GSTIN |
| `page.phone` | Phone | फ़ोन |
| `page.city` | City | शहर |
| `page.notes` | Notes | नोट |
| `page.notGiven` | Not given | नहीं दिया |
| `page.confirm` | Confirm vendor | पार्टी पक्की करें |
| `page.confirmed` | {name} confirmed | {name} पक्की हो गई |
| `page.draftNote` | Added at the kanta. Check the name and GSTIN, then confirm so it shows as a regular vendor. | कांटे पर जोड़ी गई। नाम और GSTIN जांचें, फिर पक्का करें ताकि यह आम पार्टी की तरह दिखे। |
| `page.edit` | Edit vendor | पार्टी बदलें |
| `page.archive` | Archive vendor | पार्टी बंद करें |
| `page.archived` | {name} archived | {name} बंद हो गई |
| `page.archivedNote` | Archived. It no longer shows when the yard picks a vendor. | बंद है। यार्ड पार्टी चुनते समय यह नहीं दिखती। |
| `page.restore` | Bring back | फिर से चालू करें |
| `page.restored` | {name} is back in use | {name} फिर से चालू है |
| `page.mergeHere` | Merge duplicates into this vendor | इसमें डुप्लिकेट मिलाएं |
| `page.mergedNote` | Merged into {name}. Its lots and spellings are there now. | {name} में मिला दी गई। इसके लॉट और नाम अब वहीं हैं। |
| `page.openKeeper` | Open {name} | {name} खोलें |
| `page.spellings` | Other spellings | दूसरे नाम |
| `page.spellingsHint` | Names the book, slips or the floor use for this vendor. Searching any of them finds it. | बुक, पर्ची या फ़्लोर पर इस पार्टी के लिए लिखे जाने वाले नाम। इनमें से कोई भी खोजने पर यही पार्टी मिलती है। |
| `page.noSpellings` | No other spellings yet. | अभी कोई दूसरा नाम नहीं। |
| `page.spellingLabel` | New spelling | नया नाम |
| `page.addSpelling` | Add spelling | नाम जोड़ें |
| `page.spellingRequired` | Type the spelling to add. | जोड़ने के लिए नाम लिखें। |
| `page.spellingAdded` | Spelling {alias} added | नाम {alias} जुड़ गया |
| `page.removeSpelling` | Remove {alias} | {alias} हटाएं |
| `page.spellingRemoved` | Spelling {alias} removed | नाम {alias} हटा दिया |
| `page.usualItems` | Usual items | आम आइटम |
| `page.usualItemsHint` | From the latest 50 lots. | पिछले 50 लॉट से। |
| `page.lastRate` | Last rate {rate} | आखिरी रेट {rate} |
| `page.lotCount` | {count} {count:lot\|lots} | {count} लॉट |
| `page.noLots` | No lots from this vendor yet. | इस पार्टी का अभी कोई लॉट नहीं। |
| `page.recentLots` | Recent lots | हाल के लॉट |
| `page.columns.lot` | Lot | लॉट |
| `page.columns.date` | Date | तारीख |
| `page.columns.item` | Item | आइटम |
| `page.columns.rate` | Rate | रेट |
| `page.columns.status` | Status | स्टेटस |
| `page.ratePerKg` | ₹{rate}/kg | ₹{rate}/kg |
| `page.lotStatus.booking` | Booked | बुक |
| `page.lotStatus.unload` | Unloading | उतर रहा है |
| `page.lotStatus.ok` | OK | OK |
| `page.lotStatus.cancelled` | Cancelled | रद्द |
| `page.notFound` | This vendor doesn't exist in this company. | यह पार्टी इस कंपनी में नहीं है। |
| `form.addTitle` | Add vendor | पार्टी जोड़ें |
| `form.editTitle` | Edit vendor | पार्टी बदलें |
| `form.name` | Name | नाम |
| `form.nameHint` | As on their bill. Brokers are not vendors. | जैसा उनके बिल पर है। दलाल पार्टी नहीं होते। |
| `form.nameRequired` | Give the vendor a name. | पार्टी का नाम डालें। |
| `form.gstin` | GSTIN | GSTIN |
| `form.gstinHint` | 15 characters. Leave blank for an unregistered vendor. | 15 अक्षर। बिना रजिस्ट्रेशन वाली पार्टी के लिए खाली छोड़ें। |
| `form.gstinInvalid` | That isn't a valid GSTIN. It has 15 characters, like 24ABCDE1234F1Z5. | यह सही GSTIN नहीं है। इसमें 15 अक्षर होते हैं, जैसे 24ABCDE1234F1Z5। |
| `form.phone` | Phone | फ़ोन |
| `form.city` | City | शहर |
| `form.notes` | Notes | नोट |
| `form.spellings` | Other spellings | दूसरे नाम |
| `form.spellingsHint` | Optional. One per line, as the book or slips write it. | चाहें तो। हर लाइन में एक, जैसा बुक या पर्ची में लिखा हो। |
| `form.save` | Save vendor | पार्टी सेव करें |
| `mergeSheet.title` | Merge vendors | पार्टियां मिलाएं |
| `mergeSheet.titleInto` | Merge into {name} | {name} में मिलाएं |
| `mergeSheet.body` | Pick the duplicates. Their lots and spellings move to the vendor you keep, and their names become its other spellings. | डुप्लिकेट चुनें। उनके लॉट और नाम रखी जाने वाली पार्टी में चले जाएंगे, और उनके नाम उसके दूसरे नाम बन जाएंगे। |
| `mergeSheet.keep` | Keep this vendor | यह पार्टी रखें |
| `mergeSheet.keepPlaceholder` | Search vendors | पार्टी खोजें |
| `mergeSheet.keepHint` | Only a confirmed vendor can be kept. | सिर्फ़ पक्की पार्टी रखी जा सकती है। |
| `mergeSheet.keepRequired` | Choose the vendor to keep. | रखने वाली पार्टी चुनें। |
| `mergeSheet.search` | Find duplicates | डुप्लिकेट खोजें |
| `mergeSheet.searchHint` | Started from the name. Change it to find other spellings. | नाम से शुरू किया है। दूसरे नाम खोजने के लिए बदलें। |
| `mergeSheet.noMatches` | No other vendors match {query}. | {query} से कोई दूसरी पार्टी नहीं मिली। |
| `mergeSheet.typeToSearch` | Type a name to find duplicates. | डुप्लिकेट खोजने के लिए नाम लिखें। |
| `mergeSheet.picked` | {count} {count:duplicate\|duplicates} picked | {count} डुप्लिकेट चुने |
| `mergeSheet.pickOne` | Pick at least one duplicate. | कम से कम एक डुप्लिकेट चुनें। |
| `mergeSheet.submit` | Merge {count} | {count} मिलाएं |
| `mergeSheet.confirmTitle` | Merge {count} {count:vendor\|vendors} into {name}? | {count} {count:पार्टी\|पार्टियां} {name} में मिलाएं? |
| `mergeSheet.confirmBody` | This can't be undone. {names} will stop showing in lists, and their lots and spellings move to {name}. | यह वापस नहीं होगा। {names} लिस्ट में नहीं दिखेंगी, और उनके लॉट और नाम {name} में चले जाएंगे। |
| `mergeSheet.confirm` | Merge | मिलाएं |
| `mergeSheet.done` | Merged into {name}. {count} {count:lot\|lots} moved. | {name} में मिला दी गईं। {count} लॉट गए। |
| `errors.nameTaken` | {name} already uses that name or spelling. | यह नाम {name} के पास पहले से है। |
| `errors.nameTakenOther` | Another vendor already uses that name. | यह नाम किसी दूसरी पार्टी के पास पहले से है। |
| `errors.spellingTaken` | Another vendor already uses that spelling. | यह नाम किसी दूसरी पार्टी के पास पहले से है। |
| `errors.spellingIsName` | That is already the vendor's name. | यह तो पार्टी का अपना नाम है। |
| `errors.confirmKeeperFirst` | Confirm this vendor before merging others into it. | दूसरी पार्टियां मिलाने से पहले इसे पक्का करें। |
| `errors.alreadyMerged` | One of these vendors was merged a moment ago. Pick again. | इनमें से एक पार्टी अभी-अभी मिलाई गई। फिर से चुनें। |
| `errors.wasMerged` | This vendor was merged into another one. | यह पार्टी किसी दूसरी में मिला दी गई है। |
| `errors.keepLive` | Keep a vendor that is in use, not an archived one. | चालू पार्टी रखें, बंद वाली नहीं। |

### guides (15)

| Key | English | हिंदी |
|---|---|---|
| `title` | Guides | गाइड |
| `subtitle` | Step by step help for each job in orrn. | orrn के हर काम के लिए कदम दर कदम मदद। |
| `howTo` | How to | कैसे करें |
| `when` | When to use this | कब इस्तेमाल करें |
| `steps` | Steps | कदम |
| `problems` | If something goes wrong | कोई दिक्कत आए तो |
| `step` | Step {n} | कदम {n} |
| `forRoles` | For: {roles} | किसके लिए: {roles} |
| `open` | Open guide | गाइड खोलें |
| `all` | All guides | सारी गाइड |
| `empty` | No guides for your role yet. | आपके रोल के लिए अभी कोई गाइड नहीं है। |
| `related` | Related screens | जुड़ी स्क्रीन |
| `platformRole` | orrn support staff | orrn सपोर्ट स्टाफ़ |
| `notFoundTitle` | We don't have that guide | यह गाइड हमारे पास नहीं है |
| `notFoundBody` | The link may be old or mistyped. Pick a guide from the list. | लिंक पुराना या गलत हो सकता है। लिस्ट से कोई गाइड चुनें। |

### admin (351)

| Key | English | हिंदी |
|---|---|---|
| `title` | Godseye | Godseye |
| `overview.title` | Overview | सारांश |
| `overview.subtitle` | Companies, access requests and staff on orrn. | orrn पर कंपनियां, एक्सेस रिक्वेस्ट और स्टाफ़। |
| `overview.kpis` | At a glance | एक नज़र में |
| `overview.active` | Active companies | चालू कंपनियां |
| `overview.activeMeta` | {count} in total | कुल {count} |
| `overview.suspended` | Suspended | रोकी गई |
| `overview.suspendedMeta` | Access paused | एक्सेस रुका हुआ |
| `overview.pending` | Access requests | एक्सेस रिक्वेस्ट |
| `overview.pendingMeta` | Waiting for review | जांच बाकी है |
| `overview.pendingNone` | All reviewed | सब जांच ली गईं |
| `overview.staff` | Staff | स्टाफ़ |
| `overview.staffMeta` | Godseye logins | Godseye लॉगिन |
| `overview.waiting` | Waiting for review | जांच बाकी |
| `overview.waitingEmpty` | No requests waiting. | कोई रिक्वेस्ट बाकी नहीं है। |
| `overview.recent` | Recent companies | हाल की कंपनियां |
| `overview.recentEmpty` | Approved requests become companies here. | मंज़ूर रिक्वेस्ट यहां कंपनी बनकर दिखती हैं। |
| `overview.viewAll` | View all | सब देखें |
| `overview.viewAllRequests` | View all access requests | सब देखें: एक्सेस रिक्वेस्ट |
| `overview.viewAllCompanies` | View all companies | सब देखें: कंपनियां |
| `overview.loadError` | The overview didn't load. Check the connection and try again. | सारांश लोड नहीं हुआ। कनेक्शन देखें और फिर कोशिश करें। |
| `companies.title` | Companies | कंपनियां |
| `companies.subtitle` | {count} {count:company\|companies} on orrn | orrn पर {count} {count:कंपनी\|कंपनियां} |
| `companies.subtitleFiltered` | {count} {count:company matches\|companies match} | {count} {count:कंपनी मिली\|कंपनियां मिलीं} |
| `companies.search` | Search companies | कंपनी खोजें |
| `companies.searchHint` | Name or short name | नाम या छोटा नाम |
| `companies.status` | Status | स्थिति |
| `companies.printingOnly` | Only with label printing | सिर्फ़ लेबल प्रिंटिंग वाली |
| `companies.filterPending` | Waiting | बाकी |
| `companies.columns.company` | Company | कंपनी |
| `companies.columns.status` | Status | स्थिति |
| `companies.columns.printing` | Label printing | लेबल प्रिंटिंग |
| `companies.columns.members` | Members | सदस्य |
| `companies.columns.joined` | Joined | जुड़ी |
| `companies.empty` | No companies yet. Approved access requests show up here. | अभी कोई कंपनी नहीं है। मंज़ूर एक्सेस रिक्वेस्ट यहां दिखती हैं। |
| `companies.emptyFiltered` | No companies match. Try another search or filter. | कोई कंपनी मेल नहीं खाती। दूसरी खोज या फ़िल्टर आज़माएं। |
| `companies.clearFilters` | Clear filters | फ़िल्टर हटाएं |
| `companies.loadError` | Companies didn't load. Check the connection and try again. | कंपनियां लोड नहीं हुईं। कनेक्शन देखें और फिर कोशिश करें। |
| `companies.listLabel` | Companies | कंपनियां |
| `company.back` | Companies | कंपनियां |
| `company.facts` | Company facts | कंपनी की जानकारी |
| `company.status` | Status | स्थिति |
| `company.plan` | Plan | प्लान |
| `company.members` | Members | सदस्य |
| `company.joined` | Joined | जुड़ी |
| `company.noPlan` | No plan | कोई प्लान नहीं |
| `company.notFound` | This company doesn't exist, or it was removed. | यह कंपनी मौजूद नहीं है, या हटा दी गई है। |
| `company.loadError` | This company didn't load. Check the connection and try again. | यह कंपनी लोड नहीं हुई। कनेक्शन देखें और फिर कोशिश करें। |
| `company.suspend` | Suspend | रोकें |
| `company.suspendTitle` | Suspend {company}? | {company} को रोकें? |
| `company.suspendBody` | Everyone at {company} loses access until you reactivate it. Their data stays. | {company} के सभी लोगों का एक्सेस तब तक बंद रहेगा जब तक आप इसे फिर से चालू नहीं करते। उनका डेटा बना रहेगा। |
| `company.suspended` | Company suspended | कंपनी रोक दी गई |
| `company.reactivate` | Reactivate | फिर से चालू करें |
| `company.reactivateTitle` | Reactivate {company}? | {company} को फिर से चालू करें? |
| `company.reactivateBody` | Everyone at {company} can sign in again. | {company} के सभी लोग फिर से साइन इन कर सकेंगे। |
| `company.reactivated` | Company reactivated | कंपनी फिर से चालू हो गई |
| `company.reviewRequest` | Review the request | रिक्वेस्ट देखें |
| `company.sections` | Company sections | कंपनी के हिस्से |
| `company.tabs.plan` | Plan and modules | प्लान और मॉड्यूल |
| `company.tabs.printing` | Printing | प्रिंटिंग |
| `company.tabs.access` | Access | एक्सेस |
| `company.tabs.audit` | Audit | ऑडिट |
| `company.auditEmpty` | Nothing has been recorded for this company yet. | इस कंपनी के लिए अभी कुछ दर्ज नहीं हुआ। |
| `releases.title` | App builds | ऐप बिल्ड |
| `releases.subtitle` | Publish a build of the floor app. Phones and tablets below the minimum build cannot open the app. | फ़्लोर ऐप का बिल्ड प्रकाशित करें। न्यूनतम बिल्ड से नीचे के फ़ोन और टैबलेट पर ऐप नहीं खुलेगा। |
| `releases.publishTitle` | Publish a build | बिल्ड प्रकाशित करें |
| `releases.platform` | Platform | प्लेटफ़ॉर्म |
| `releases.channel` | Channel | चैनल |
| `releases.channels.production` | Production | प्रोडक्शन |
| `releases.channels.floor` | Floor | फ़्लोर |
| `releases.channels.stable` | Stable | स्थिर |
| `releases.channels.beta` | Beta | बीटा |
| `releases.platforms.android` | Android | Android |
| `releases.platforms.ios` | iPhone and iPad | iPhone और iPad |
| `releases.platforms.web` | Web | वेब |
| `releases.platforms.edge` | Print station | प्रिंट स्टेशन |
| `releases.version` | Version | वर्शन |
| `releases.versionHint` | For example 1.4.0 | जैसे 1.4.0 |
| `releases.build` | Build number | बिल्ड नंबर |
| `releases.buildHint` | Must be higher than the last build on this platform. | इस प्लेटफ़ॉर्म के पिछले बिल्ड से बड़ा होना चाहिए। |
| `releases.minBuild` | Minimum build | न्यूनतम बिल्ड |
| `releases.minBuildHint` | Leave blank to keep the current minimum ({current}). Raising it blocks older builds. Not above the build number. | खाली छोड़ें तो मौजूदा न्यूनतम ({current}) बना रहता है। इसे बढ़ाने पर पुराने बिल्ड रुक जाते हैं। बिल्ड नंबर से ऊपर नहीं। |
| `releases.mandatory` | Mandatory: raise the floor for older builds too | ज़रूरी: पुराने बिल्ड के लिए भी सीमा ऊपर करें |
| `releases.mandatoryYes` | Mandatory | ज़रूरी |
| `releases.mandatoryNo` | Optional | वैकल्पिक |
| `releases.mandatorySwitch` | Mandatory: {version} | ज़रूरी: {version} |
| `releases.mandatorySet` | Marked mandatory | ज़रूरी कर दिया |
| `releases.mandatoryCleared` | No longer mandatory | अब ज़रूरी नहीं |
| `releases.mandatoryFailed` | Couldn't change that build. Try again. | यह बिल्ड नहीं बदला। फिर कोशिश करें। |
| `releases.notes` | Release notes | रिलीज़ नोट |
| `releases.notesHint` | Up to {max} characters. Shown to people who need to update. | ज़्यादा से ज़्यादा {max} अक्षर। अपडेट करने वालों को दिखता है। |
| `releases.apkUrl` | Download link for the floor app | फ़्लोर ऐप का डाउनलोड लिंक |
| `releases.apkHint` | Android floor builds only. | सिर्फ़ Android फ़्लोर बिल्ड के लिए। |
| `releases.publish` | Publish build | बिल्ड प्रकाशित करें |
| `releases.published` | Build published | बिल्ड प्रकाशित हो गया |
| `releases.listTitle` | Published builds | प्रकाशित बिल्ड |
| `releases.empty` | No build has been published yet. | अभी कोई बिल्ड प्रकाशित नहीं हुआ। |
| `releases.loadError` | Builds didn't load. Check the connection and try again. | बिल्ड लोड नहीं हुए। कनेक्शन देखकर फिर कोशिश करें। |
| `releases.columns.version` | Version | वर्शन |
| `releases.columns.platform` | Platform | प्लेटफ़ॉर्म |
| `releases.columns.build` | Build | बिल्ड |
| `releases.columns.minimum` | Minimum | न्यूनतम |
| `releases.columns.mandatory` | Mandatory | ज़रूरी |
| `releases.columns.notes` | Notes | नोट्स |
| `releases.columns.published` | Published | प्रकाशित |
| `releases.errors.minAbove` | The minimum build can't be above the build number. | न्यूनतम बिल्ड, बिल्ड नंबर से ऊपर नहीं हो सकता। |
| `releases.errors.notAbove` | That build number is not above the last published build. | यह बिल्ड नंबर पिछले प्रकाशित बिल्ड से ऊपर नहीं है। |
| `releases.errors.exists` | That version is already published on this channel. | यह वर्शन इस चैनल पर पहले से प्रकाशित है। |
| `releases.errors.generic` | The build didn't publish. Check the fields and try again. | बिल्ड प्रकाशित नहीं हुआ। खाने जांचकर फिर कोशिश करें। |
| `releases.errors.android` | A download link is for Android only. | डाउनलोड लिंक सिर्फ़ Android के लिए है। |
| `backups.title` | Backups | बैकअप |
| `backups.subtitle` | Daily exports and restore drills for every plant. | हर प्लांट के रोज़ के बैकअप और रिस्टोर ड्रिल। |
| `backups.company` | Plant | प्लांट |
| `backups.allCompanies` | All plants | सभी प्लांट |
| `backups.runNow` | Back up now | अभी बैकअप लें |
| `backups.runDrill` | Run restore drill | रिस्टोर ड्रिल चलाएं |
| `backups.ran` | Backup finished | बैकअप पूरा हुआ |
| `backups.drilled` | Restore drill finished | रिस्टोर ड्रिल पूरी हुई |
| `backups.kind.scheduled` | Daily | रोज़ का |
| `backups.kind.manual` | By hand | हाथ से |
| `backups.purpose.export` | Backup | बैकअप |
| `backups.purpose.drill` | Restore drill | रिस्टोर ड्रिल |
| `backups.status.ok` | Done | हो गया |
| `backups.status.running` | Running | चल रहा है |
| `backups.status.failed` | Failed | नहीं हुआ |
| `backups.status.succeeded` | Done | हो गया |
| `backups.columns.plant` | Plant | प्लांट |
| `backups.columns.what` | What | क्या |
| `backups.columns.status` | Status | स्थिति |
| `backups.columns.started` | Started | शुरू |
| `backups.columns.size` | Size | आकार |
| `backups.columns.rows` | Rows | पंक्तियां |
| `backups.columns.detail` | Detail | ब्योरा |
| `backups.empty` | No backup has run yet. | अभी कोई बैकअप नहीं चला। |
| `backups.loadError` | Backups didn't load. Check the connection and try again. | बैकअप लोड नहीं हुए। कनेक्शन देखकर फिर कोशिश करें। |
| `backups.actionFailed` | That didn't finish. Check the list for the reason. | यह पूरा नहीं हुआ। कारण के लिए सूची देखें। |
| `backups.pickPlant` | Pick a plant first. | पहले प्लांट चुनें। |
| `backups.matches` | Counts match | गिनती मिलती है |
| `backups.mismatch` | Counts differ | गिनती अलग है |
| `support.title` | Support requests | सपोर्ट अनुरोध |
| `support.subtitle` | Questions from plants. Answer or close each one. | प्लांट के सवाल। हर एक का जवाब दें या उसे बंद करें। |
| `support.status` | Status | स्थिति |
| `support.allStatuses` | All | सभी |
| `support.columns.plant` | Plant | प्लांट |
| `support.columns.subject` | Subject | विषय |
| `support.columns.status` | Status | स्थिति |
| `support.columns.asked` | Asked | कब पूछा |
| `support.empty` | No requests here. | यहां कोई अनुरोध नहीं। |
| `support.loadError` | Requests didn't load. Check the connection and try again. | अनुरोध लोड नहीं हुए। कनेक्शन देखकर फिर कोशिश करें। |
| `support.from` | From {screen} | {screen} से |
| `support.yourReply` | Your reply | आपका जवाब |
| `support.send` | Send reply | जवाब भेजें |
| `support.sendClose` | Send and close | भेजें और बंद करें |
| `support.close` | Close without a reply | बिना जवाब बंद करें |
| `support.replied` | Reply sent | जवाब भेज दिया |
| `support.closed` | Request closed | अनुरोध बंद हो गया |
| `support.conflict` | Someone else answered or closed this request. It has been reloaded. | किसी और ने इसका जवाब दे दिया या इसे बंद कर दिया। इसे फिर लोड किया गया है। |
| `support.failed` | That didn't send. Try again. | यह नहीं गया। फिर कोशिश करें। |
| `support.earlierReply` | Reply sent {time} | जवाब {time} को भेजा गया |
| `support.readOnly` | Your role can read requests but not answer them. | आपकी भूमिका अनुरोध पढ़ सकती है, जवाब नहीं दे सकती। |
| `plan.plan` | Plan | प्लान |
| `plan.plans.starter` | Starter | स्टार्टर |
| `plan.plans.growth` | Growth | ग्रोथ |
| `plan.plans.enterprise` | Enterprise | एंटरप्राइज़ |
| `plan.modules` | Modules | मॉड्यूल |
| `plan.modulesHint` | Untick a module to hide it from the company's menus. | किसी मॉड्यूल का टिक हटाएं तो वह कंपनी के मेन्यू से छिप जाएगा। |
| `plan.modulesNone` | Keep at least one module on. | कम से कम एक मॉड्यूल चालू रखें। |
| `plan.moduleNames.customers` | Customers | कस्टमर |
| `plan.moduleNames.dies` | Dies | डाई |
| `plan.moduleNames.bundles` | Packing and stock | पैकिंग और स्टॉक |
| `plan.moduleNames.dispatches` | Dispatch and packing lists | डिस्पैच और पैकिंग लिस्ट |
| `plan.moduleNames.orders` | Orders and planning | ऑर्डर और प्लानिंग |
| `plan.moduleNames.foundry` | Foundry | फ़ाउंड्री |
| `plan.moduleNames.press` | Press | प्रेस |
| `plan.moduleNames.ageing` | Ageing | एजिंग |
| `plan.moduleNames.store` | Store | स्टोर |
| `plan.moduleNames.purchase` | Scrap purchase | स्क्रैप खरीद |
| `plan.moduleHints.customers` | Customer list and addresses | कस्टमर लिस्ट और पते |
| `plan.moduleHints.dies` | Die list and weight ranges | डाई लिस्ट और वज़न रेंज |
| `plan.moduleHints.bundles` | Pack, scan, stock and labels | पैक, स्कैन, स्टॉक और लेबल |
| `plan.moduleHints.dispatches` | Dispatches and printed packing lists | डिस्पैच और छपी पैकिंग लिस्ट |
| `plan.moduleHints.orders` | Sales orders, baki and press plans | सेल्स ऑर्डर, बाकी और प्रेस प्लान |
| `plan.moduleHints.foundry` | Casts, melts and spectro | कास्ट, मेल्ट और स्पेक्ट्रो |
| `plan.moduleHints.press` | Press runs and the press console | प्रेस रन और प्रेस कंसोल |
| `plan.moduleHints.ageing` | Ageing batches and readings | एजिंग बैच और रीडिंग |
| `plan.moduleHints.store` | Store items, GRN and issues | स्टोर आइटम, GRN और इशू |
| `plan.moduleHints.purchase` | Scrap vendors, lots and D/C notes | स्क्रैप वेंडर, लॉट और D/C नोट |
| `plan.save` | Save plan | प्लान सेव करें |
| `plan.saved` | Plan saved | प्लान सेव हो गया |
| `plan.unsaved` | Unsaved changes | बदलाव सेव नहीं हुए |
| `plan.noPlanYet` | No plan saved yet. | अभी कोई प्लान सेव नहीं है। |
| `printing.noneTitle` | Label printing isn't set up | लेबल प्रिंटिंग सेट नहीं है |
| `printing.noneBody` | Set up a print station so {company} can print bundle labels on their own printers. | प्रिंट स्टेशन सेट करें ताकि {company} अपने प्रिंटर पर बंडल लेबल छाप सके। |
| `printing.setUp` | Set up label printing | लेबल प्रिंटिंग सेट करें |
| `printing.inactive` | Only active companies can print labels. Reactivate {company} first. | सिर्फ़ चालू कंपनियां लेबल छाप सकती हैं। पहले {company} को फिर से चालू करें। |
| `printing.waiting` | Only active companies can print labels. Approve the access request for {company} first. | सिर्फ़ चालू कंपनियां लेबल छाप सकती हैं। पहले {company} की एक्सेस रिक्वेस्ट मंज़ूर करें। |
| `printing.addAnother` | Add a print station | एक और प्रिंट स्टेशन जोड़ें |
| `printing.station` | Print station | प्रिंट स्टेशन |
| `printing.address` | Address | पता |
| `printing.version` | Version | वर्ज़न |
| `printing.versionUnknown` | Not reported yet | अभी नहीं बताया |
| `printing.lastSeen` | Last seen | आखिरी बार दिखा |
| `printing.never` | Never | कभी नहीं |
| `printing.setUpOn` | Set up | सेट किया |
| `printing.setUpDay` | Set up {date} | {date} को सेट किया |
| `printing.nameLabel` | Station name | स्टेशन का नाम |
| `printing.nameHint` | 3 to 63 lowercase letters, numbers or hyphens. | 3 से 63 छोटे अंग्रेज़ी अक्षर, अंक या हाइफ़न। |
| `printing.namePreview` | Address: {address} | पता: {address} |
| `printing.nameRequired` | Enter a station name. | स्टेशन का नाम लिखें। |
| `printing.nameLength` | Use 3 to 63 characters. | 3 से 63 अक्षर रखें। |
| `printing.nameFormat` | Use lowercase letters, numbers and hyphens. Start and end with a letter or number. | छोटे अंग्रेज़ी अक्षर, अंक और हाइफ़न लिखें। शुरू और अंत अक्षर या अंक से हो। |
| `printing.nameTaken` | That station name is taken. Try another. | यह स्टेशन नाम पहले से लिया हुआ है। कोई दूसरा आज़माएं। |
| `printing.create` | Set up print station | प्रिंट स्टेशन सेट करें |
| `printing.created` | Print station set up | प्रिंट स्टेशन सेट हो गया |
| `printing.secretsTitle` | Copy these now | इन्हें अभी कॉपी करें |
| `printing.secretsBody` | They are shown only once. The print station needs them to connect. | ये सिर्फ़ एक बार दिखेंगे। प्रिंट स्टेशन को जुड़ने के लिए इनकी ज़रूरत है। |
| `printing.instanceId` | Instance ID | इंस्टेंस ID |
| `printing.sharedSecret` | Shared secret | शेयर्ड सीक्रेट |
| `printing.tunnelToken` | Tunnel token | टनल टोकन |
| `printing.copyValue` | Copy {label} | {label} कॉपी करें |
| `printing.copied` | {label} copied | {label} कॉपी हो गया |
| `printing.copyFailed` | Couldn't copy. Select the text and copy it. | कॉपी नहीं हुआ। टेक्स्ट चुनकर कॉपी करें। |
| `printing.rotateSecret` | Rotate secret | सीक्रेट बदलें |
| `printing.rotateTitle` | Rotate the secret for {address}? | {address} का सीक्रेट बदलें? |
| `printing.rotateBody` | The current secret stops working right away. The print station needs the new one to keep printing. | अभी वाला सीक्रेट तुरंत काम करना बंद कर देगा। प्रिंटिंग चालू रखने के लिए प्रिंट स्टेशन को नया सीक्रेट चाहिए। |
| `printing.rotated` | Secret rotated | सीक्रेट बदल गया |
| `printing.newSecret` | New shared secret | नया शेयर्ड सीक्रेट |
| `printing.installScript` | Install script | इंस्टॉल स्क्रिप्ट |
| `printing.installTitle` | Download the install script | इंस्टॉल स्क्रिप्ट डाउनलोड करें |
| `printing.installBody` | A shell script for a Linux or macOS computer with Docker. It sets up the print station for {address}. | Docker वाले Linux या macOS कंप्यूटर के लिए शेल स्क्रिप्ट। यह {address} के लिए प्रिंट स्टेशन सेट करती है। |
| `printing.installDownload` | Download script | स्क्रिप्ट डाउनलोड करें |
| `printing.installed` | Install script downloaded | इंस्टॉल स्क्रिप्ट डाउनलोड हो गई |
| `printing.downloads` | Downloads | डाउनलोड |
| `printing.downloadsTitle` | Download the print station app | प्रिंट स्टेशन ऐप डाउनलोड करें |
| `printing.downloadsBody` | The app comes set up for {address}. Run it on a computer on the plant network. | ऐप {address} के लिए पहले से सेट है। इसे प्लांट नेटवर्क के किसी कंप्यूटर पर चलाएं। |
| `printing.computer` | Computer | कंप्यूटर |
| `printing.platforms.darwinArm64` | Mac with Apple chip | Apple चिप वाला Mac |
| `printing.platforms.darwinAmd64` | Mac with Intel chip | Intel चिप वाला Mac |
| `printing.platforms.linuxAmd64` | Linux | Linux |
| `printing.platforms.windowsAmd64` | Windows | Windows |
| `printing.download` | Download app | ऐप डाउनलोड करें |
| `printing.downloadStarted` | Download started | डाउनलोड शुरू हो गया |
| `printing.turnOff` | Turn off label printing | लेबल प्रिंटिंग बंद करें |
| `printing.turnOffShort` | Turn off | बंद करें |
| `printing.turnOffTitle` | Turn off {address}? | {address} बंद करें? |
| `printing.turnOffBody` | Labels stop printing at {company} until you set up a new print station. | नया प्रिंट स्टेशन सेट होने तक {company} में लेबल नहीं छपेंगे। |
| `printing.turnedOff` | Label printing turned off | लेबल प्रिंटिंग बंद हो गई |
| `printing.history` | Turned off earlier | पहले बंद किए गए |
| `printing.loadError` | Print stations didn't load. Check the connection and try again. | प्रिंट स्टेशन लोड नहीं हुए। कनेक्शन देखें और फिर कोशिश करें। |
| `printing.stationsLabel` | Print stations | प्रिंट स्टेशन |
| `access.impersonate` | Impersonate | कंपनी के रूप में खोलें |
| `access.title` | Open {company} as support | {company} को सपोर्ट के रूप में खोलें |
| `access.body` | You see orrn as their owner would. Every change is recorded with your name. | आप orrn को उनके मालिक की तरह देखेंगे। हर बदलाव आपके नाम से दर्ज होगा। |
| `access.reasonLabel` | Reason (optional) | वजह (ज़रूरी नहीं) |
| `access.reasonHint` | Shown in the session list below. | नीचे सेशन लिस्ट में दिखेगी। |
| `access.durationLabel` | Session length (minutes) | सेशन कितनी देर (मिनट) |
| `access.started` | Support session started | सपोर्ट सेशन शुरू हुआ |
| `access.inactive` | Only active companies can be opened. Reactivate {company} first. | सिर्फ़ चालू कंपनियां खोली जा सकती हैं। पहले {company} को फिर से चालू करें। |
| `access.waiting` | Only active companies can be opened. Approve the access request for {company} first. | सिर्फ़ चालू कंपनियां खोली जा सकती हैं। पहले {company} की एक्सेस रिक्वेस्ट मंज़ूर करें। |
| `access.inside` | You are inside {company} as support. Stop that session first. | आप सपोर्ट के रूप में {company} के अंदर हैं। पहले वह सेशन बंद करें। |
| `access.restricted` | Your role can't open companies as support. | आपका रोल कंपनियों को सपोर्ट के रूप में नहीं खोल सकता। |
| `access.banner` | Viewing {company} as orrn support | {company} को orrn सपोर्ट के रूप में देख रहे हैं |
| `access.stop` | Stop impersonating | सपोर्ट व्यू बंद करें |
| `access.stopFailed` | Couldn't stop the support session. Check the connection and try again. | सपोर्ट सेशन बंद नहीं हुआ। कनेक्शन देखें और फिर कोशिश करें। |
| `access.expires` | Ends at {time} | {time} पर खत्म होगा |
| `access.endsSoon` | Ends at {time}, in under 5 minutes | {time} पर खत्म होगा, 5 मिनट से कम बचे |
| `access.sessions` | Support sessions | सपोर्ट सेशन |
| `access.sessionsEmpty` | No support sessions yet. | अभी कोई सपोर्ट सेशन नहीं। |
| `access.staff` | Staff | स्टाफ़ |
| `access.reason` | Reason | वजह |
| `access.startedAt` | Started | शुरू हुआ |
| `access.ends` | Ends | खत्म |
| `access.state.active` | Active | चालू |
| `access.state.ended` | Ended | खत्म |
| `access.state.stopped` | Stopped | बंद किया |
| `access.noReason` | No reason given | कोई वजह नहीं दी |
| `access.resume` | Resume | फिर से खोलें |
| `access.stopSession` | Stop | बंद करें |
| `access.actions` | Actions | कार्रवाई |
| `access.stopped` | Support session stopped | सपोर्ट सेशन बंद हुआ |
| `access.unknownStaff` | Former staff | पुराना स्टाफ़ |
| `access.staffYou` | {name} (you) | {name} (आप) |
| `requests.title` | Access requests | एक्सेस रिक्वेस्ट |
| `requests.waiting` | {count} waiting | {count} बाकी |
| `requests.none` | Nothing waiting | कुछ बाकी नहीं |
| `requests.empty` | No requests waiting. | कोई रिक्वेस्ट बाकी नहीं है। |
| `requests.emptyBody` | New requests from the website show up here. | वेबसाइट से आई नई रिक्वेस्ट यहां दिखेंगी। |
| `requests.from` | From {name} | {name} की ओर से |
| `requests.received` | Received {date} | आई: {date} |
| `requests.noNotes` | No notes | कोई नोट नहीं |
| `requests.approve` | Approve | मंज़ूर करें |
| `requests.approveTitle` | Approve {company}? | {company} को मंज़ूर करें? |
| `requests.approveBody` | This creates the company and emails a sign-in link to {email}. If the email can't be sent, you get the details to send yourself. | इससे कंपनी बनेगी और {email} पर साइन इन लिंक ईमेल होगा। ईमेल न जा पाए तो खुद भेजने के लिए डिटेल मिल जाएंगी। |
| `requests.approved` | Request approved | रिक्वेस्ट मंज़ूर हो गई |
| `requests.reject` | Reject | नामंज़ूर करें |
| `requests.rejectTitle` | Reject {company}? | {company} को नामंज़ूर करें? |
| `requests.rejectBody` | The request is closed. {email} is not emailed. | रिक्वेस्ट बंद हो जाएगी। {email} को ईमेल नहीं जाएगा। |
| `requests.rejected` | Request rejected | रिक्वेस्ट नामंज़ूर हो गई |
| `requests.alreadyHandled` | Someone already handled this request. The list is up to date now. | यह रिक्वेस्ट पहले ही निपटा दी गई है। लिस्ट अब ताज़ा है। |
| `requests.loadError` | Requests didn't load. Check the connection and try again. | रिक्वेस्ट लोड नहीं हुईं। कनेक्शन देखें और फिर कोशिश करें। |
| `requests.listLabel` | Waiting requests | बाकी रिक्वेस्ट |
| `requests.approvedSent` | Approved. Sign-in email sent to {email}. | मंज़ूर हो गई। साइन इन ईमेल {email} पर गया। |
| `requests.approvedNoLink` | Approved, but no sign-in link was made. Use Get sign-in details below to try again. | मंज़ूर हो गई, पर साइन इन लिंक नहीं बना। नीचे "साइन इन डिटेल लें" से फिर कोशिश करें। |
| `requests.showEmail` | Show email | ईमेल देखें |
| `requests.awaitingTitle` | Approved, password not set yet | मंज़ूर, पासवर्ड अभी नहीं बना |
| `requests.awaitingBody` | If the email did not arrive or the link stopped working, get a fresh sign-in link and send it yourself. | ईमेल न पहुंचा हो या लिंक काम न कर रहा हो, तो नया साइन इन लिंक लेकर खुद भेजें। |
| `requests.awaitingLabel` | Approved owners without a password | बिना पासवर्ड वाले मंज़ूर मालिक |
| `requests.getDetails` | Get sign-in details | साइन इन डिटेल लें |
| `requests.hasPassword` | This owner already signs in with a password; ask them to use Forgot password. | यह मालिक पहले से पासवर्ड से साइन इन करते हैं; उनसे "पासवर्ड भूल गए" इस्तेमाल करने को कहें। |
| `requests.approvedHasPassword` | Approved. This owner already signs in with a password; ask them to use Forgot password. | मंज़ूर हो गई। यह मालिक पहले से पासवर्ड से साइन इन करते हैं; उनसे "पासवर्ड भूल गए" इस्तेमाल करने को कहें। |
| `requests.approvedAskAdmin` | Approved. Your role cannot send sign-in links: ask an admin to get the sign-in details below. | मंज़ूर हो गई। आपका रोल साइन इन लिंक नहीं भेज सकता: किसी एडमिन से नीचे की साइन इन डिटेल लेने को कहें। |
| `requests.details.sentTitle` | Sign-in email sent | साइन इन ईमेल चला गया |
| `requests.details.notSentTitle` | Email could not be sent | ईमेल नहीं जा सका |
| `requests.details.body` | Send this to {name} on WhatsApp or from your own email. The link works once and expires {date}. | यह {name} को WhatsApp पर या अपने ईमेल से भेजें। लिंक एक बार चलता है और {date} को खत्म हो जाएगा। |
| `requests.details.sent` | The email went to {email}. | ईमेल {email} पर गया। |
| `requests.details.notSent` | The email did not go out. Send the details below yourself. | ईमेल नहीं गया। नीचे की डिटेल खुद भेजें। |
| `requests.details.reason` | Reason: {reason} | वजह: {reason} |
| `requests.details.to` | To | किसको |
| `requests.details.subject` | Subject | विषय |
| `requests.details.link` | Sign-in link | साइन इन लिंक |
| `requests.details.message` | Message | संदेश |
| `requests.details.copyMessage` | Copy message | संदेश कॉपी करें |
| `staff.title` | Staff | स्टाफ़ |
| `staff.subtitle` | People who can sign in to Godseye. There is no public sign-up. | जो लोग Godseye में साइन इन कर सकते हैं। यहां कोई खुला साइन अप नहीं है। |
| `staff.add` | Add staff | स्टाफ़ जोड़ें |
| `staff.addTitle` | Add a staff account | स्टाफ़ अकाउंट जोड़ें |
| `staff.name` | Name | नाम |
| `staff.email` | Email | ईमेल |
| `staff.password` | Temporary password | अस्थायी पासवर्ड |
| `staff.passwordHint` | At least 12 characters. Share it in person or on a call. | कम से कम 12 अक्षर। इसे मिलकर या कॉल पर बताएं। |
| `staff.passwordShort` | Use at least 12 characters. | कम से कम 12 अक्षर रखें। |
| `staff.emailTaken` | An account with this email already exists. | इस ईमेल से पहले से एक अकाउंट है। |
| `staff.role` | Role | रोल |
| `staff.roleHints.super_admin` | Everything, including removing staff. | सब कुछ, स्टाफ़ हटाना भी। |
| `staff.roleHints.admin` | Companies, requests, printing, support sessions and adding staff. | कंपनियां, रिक्वेस्ट, प्रिंटिंग, सपोर्ट सेशन और स्टाफ़ जोड़ना। |
| `staff.roleHints.support` | Companies and requests. No support sessions or printing. | कंपनियां और रिक्वेस्ट। सपोर्ट सेशन या प्रिंटिंग नहीं। |
| `staff.create` | Add account | अकाउंट जोड़ें |
| `staff.created` | Staff account added | स्टाफ़ अकाउंट जुड़ गया |
| `staff.you` | You | आप |
| `staff.added` | Added | जोड़ा गया |
| `staff.roleFor` | Role for {name} | {name} का रोल |
| `staff.roleChanged` | Role changed | रोल बदल गया |
| `staff.remove` | Remove | हटाएं |
| `staff.removeLabel` | Remove {name} | {name} को हटाएं |
| `staff.removeTitle` | Remove {name}? | {name} को हटाएं? |
| `staff.removeBody` | {email} can no longer sign in to Godseye. | {email} अब Godseye में साइन इन नहीं कर पाएगा। |
| `staff.removed` | Staff access removed | स्टाफ़ एक्सेस हटा दिया गया |
| `staff.actions` | Actions | कार्रवाई |
| `staff.empty` | No staff yet. | अभी कोई स्टाफ़ नहीं। |
| `staff.loadError` | Staff didn't load. Check the connection and try again. | स्टाफ़ लोड नहीं हुआ। कनेक्शन देखें और फिर कोशिश करें। |
| `staff.listLabel` | Staff accounts | स्टाफ़ अकाउंट |

### marketing (34)

| Key | English | हिंदी |
|---|---|---|
| `headline` | Every bundle, accounted for. | हर bundle का पूरा हिसाब। |
| `sub` | orrn tracks each bundle from packing to dispatch, so the floor and the office see the same stock. | orrn हर bundle को पैकिंग से dispatch तक ट्रैक करता है, ताकि फ़्लोर और ऑफ़िस एक ही स्टॉक देखें। |
| `requestAccess` | Request access | एक्सेस मांगें |
| `signIn` | Sign in | साइन इन करें |
| `homeLabel` | orrn home | orrn होम |
| `metaTitle` | orrn: every bundle, accounted for | orrn: हर bundle का पूरा हिसाब |
| `visual.bundles` | {count:bundle\|bundles} | {count:bundle\|bundle} |
| `visual.pieces` | {count} pcs | {count} पीस |
| `visual.packingListReady` | Packing list ready | पैकिंग लिस्ट तैयार |
| `flow.title` | Pack. Stock. Dispatch. | पैकिंग। स्टॉक। Dispatch। |
| `flow.pack` | Enter each bundle's weight and pieces, and print its label. | हर bundle का वज़न और पीस डालें, और उसका लेबल प्रिंट करें। |
| `flow.stock` | See what's in stock by section, in bundles and kg. | सेक्शन के हिसाब से स्टॉक देखें, bundle और kg में। |
| `flow.dispatch` | Scan bundles into a dispatch and print the packing list. | Bundle स्कैन करके dispatch में डालें और पैकिंग लिस्ट प्रिंट करें। |
| `floor.title` | Built for the floor | फ़्लोर के लिए बना |
| `floor.buttons` | Big buttons and big numbers, easy to hit with gloves on. | बड़े बटन और बड़े नंबर, दस्ताने पहनकर भी आसानी से दबें। |
| `floor.hindi` | Hindi and English, one tap apart. | हिंदी और English, एक टैप पर। |
| `floor.camera` | Scan labels with the phone camera. | फ़ोन के कैमरे से लेबल स्कैन करें। |
| `floor.devices` | Runs on a phone, a tablet or a laptop. | फ़ोन, टैबलेट या लैपटॉप पर चलता है। |
| `floor.tryIt` | Try it on this page | इसी पेज पर आज़माएं |
| `office.title` | For the office | ऑफ़िस के लिए |
| `office.stock` | Stock by section, up to date as bundles are packed and dispatched. | सेक्शन के हिसाब से स्टॉक, हर पैकिंग और dispatch के साथ अपडेट। |
| `office.packingList` | Packing lists with your company header, ready to print or send. | आपकी कंपनी के हेडर वाली पैकिंग लिस्ट, प्रिंट करने या भेजने के लिए तैयार। |
| `office.labels` | Labels print on your own printers over the plant network. | प्लांट के नेटवर्क पर आपके अपने प्रिंटर से लेबल प्रिंट होते हैं। |
| `office.demoCompany` | Your company name | आपकी कंपनी का नाम |
| `office.demoCustomer` | Demo customer | डेमो ग्राहक |
| `trust.title` | Your data stays yours | आपका डेटा आपका ही रहता है |
| `trust.separate` | Each company's data is kept apart from every other company. | हर कंपनी का डेटा बाकी कंपनियों से अलग रखा जाता है। |
| `trust.audit` | Every change is logged with who made it and when. | हर बदलाव का रिकॉर्ड रहता है, किसने किया और कब। |
| `trust.roles` | Roles decide who can pack, dispatch or change settings. | रोल तय करते हैं कि कौन पैकिंग, dispatch या सेटिंग्स बदल सकता है। |
| `cta.title` | Try it on your floor | अपने फ़्लोर पर आज़माएं |
| `cta.body` | Tell us about your plant and we'll get in touch. | अपने प्लांट के बारे में बताएं, हम संपर्क करेंगे। |
| `footer` | For aluminium extrusion plants | एल्युमिनियम एक्सट्रूज़न प्लांट के लिए |
| `footerNav` | Footer | फ़ुटर |
| `copyright` | © {year} orrn | © {year} orrn |

### refusal (163)

| Key | English | हिंदी |
|---|---|---|
| `notFoundDie` | That die was not found. Go back and open it again. | वह die नहीं मिली। वापस जाकर फिर खोलें। |
| `notFoundIssue` | That die issue was not found. | वह die issue नहीं मिला। |
| `notFoundRun` | That run was not found. | वह रन नहीं मिला। |
| `notFoundPress` | That press was not found. | वह press नहीं मिला। |
| `notFoundMaker` | That die maker was not found. | वह die मेकर नहीं मिला। |
| `notFoundOrder` | That order was not found. Go back and open it again. | वह ऑर्डर नहीं मिला। वापस जाकर फिर खोलें। |
| `notFoundBundle` | A bundle was not found. | एक bundle नहीं मिला। |
| `notFoundPlan` | That press plan was not found. | वह press प्लान नहीं मिला। |
| `notFoundCustomer` | That customer was not found. | वह कस्टमर नहीं मिला। |
| `copyState` | {code} can't be used for this now. Status: {state}. | {code} अभी इसके लिए इस्तेमाल नहीं हो सकती। स्थिति: {state}। |
| `retired` | {code} is retired. | {code} बंद की जा चुकी है। |
| `retiredNoReadings` | {code} is retired. It takes no readings. | {code} बंद है। इसकी रीडिंग नहीं ली जाती। |
| `sectionDeleted` | {code} belongs to a die that was deleted. It can't be issued. | {code} जिस die की है वह हटा दी गई है। इसे issue नहीं कर सकते। |
| `alreadyIssued` | {code} is already issued to {line}. | {code} पहले से {line} को issue है। |
| `copyOnTrialIssue` | {code} is on trial. It goes only to a trial run until the trial passes or a manager releases it. | {code} ट्रायल पर है। ट्रायल पास होने या मैनेजर के छोड़ने तक यह सिर्फ ट्रायल रन पर जाएगी। |
| `runHasDie` | {run} already has a die or has started. Only a queued run takes a die. | {run} के पास पहले से die है या वह शुरू हो चुका है। सिर्फ कतार वाले रन को die मिलती है। |
| `notCopyOfRunDie` | {code} is not a copy of the die {run} needs. | {code} उस die की कॉपी नहीं है जो {run} को चाहिए। |
| `runOtherLine` | {run} is planned on another press. | {run} दूसरे press पर प्लान है। |
| `changed` | This changed while you were working and nothing was saved. Open it again and check. | आपके काम करते समय यह बदल गया और कुछ सेव नहीं हुआ। इसे फिर खोलकर देखें। |
| `dieOnPress` | {code} is in the press for {run}. Take the die out first. | {code} {run} के लिए press में है। पहले die बाहर निकालें। |
| `issueClosed` | This die issue is already closed. | यह die issue पहले ही बंद हो चुका है। |
| `runStartedReturn` | {run} has started. Return the die when it is out. | {run} शुरू हो चुका है। die बाहर आने पर उसे लौटाएं। |
| `editIssued` | {code} is on a press. Return it before editing the card. | {code} press पर है। कार्ड बदलने से पहले उसे लौटाएं। |
| `editAtMaker` | {code} is at the die maker. Receive it before editing the card. | {code} die मेकर के पास है। कार्ड बदलने से पहले उसे वापस लें। |
| `nitridingStepOnly` | Send {code} to nitriding from the nitriding step of its card, not by editing its status. | {code} को नाइट्राइडिंग पर कार्ड के नाइट्राइडिंग स्टेप से भेजें, स्थिति बदलकर नहीं। |
| `backFromNitridingFirst` | {code} is out at nitriding. Record it back from nitriding first. | {code} नाइट्राइडिंग पर बाहर है। पहले उसे नाइट्राइडिंग से वापस दर्ज करें। |
| `onTrialRelease` | {code} is on trial. It becomes available when a trial passes, or a manager releases it. | {code} ट्रायल पर है। ट्रायल पास होने पर या मैनेजर के छोड़ने पर यह उपलब्ध होगी। |
| `badStatusMove` | {code} can't be moved to that status from where it is. | {code} अभी जिस स्थिति में है वहां से उस स्थिति में नहीं जा सकती। |
| `ownerSetManager` | Only a manager or admin can set who owns a die. | die का मालिक सिर्फ मैनेजर या एडमिन तय कर सकता है। |
| `sectionOwned` | This die belongs to a customer. Its copies can't be given to someone else or made plant-owned. | यह die किसी कस्टमर की है। इसकी कॉपी किसी और को नहीं दी जा सकती और प्लांट की नहीं बनाई जा सकती। |
| `pickMaker` | Pick an active die maker. | कोई चालू die मेकर चुनें। |
| `sectionArchived` | This die is archived. No new copies can be added. | यह die आर्काइव है। नई कॉपी नहीं जोड़ी जा सकती। |
| `newOnRack` | A new copy starts in the rack. Send it to nitriding from its card. | नई कॉपी रैक में शुरू होती है। उसे कार्ड से नाइट्राइडिंग पर भेजें। |
| `newOnTrial` | A new copy starts on trial. A manager can release it once it has passed. | नई कॉपी ट्रायल पर शुरू होती है। पास होने पर मैनेजर उसे छोड़ सकता है। |
| `pickBand` | Pick a band of this die. | इस die का कोई बैंड चुनें। |
| `nitridingFuture` | The nitriding date can't be in the future. | नाइट्राइडिंग की तारीख आगे की नहीं हो सकती। |
| `bandOnlyLift` | A band is only given with a lift. | बैंड सिर्फ लिफ्ट के साथ दिया जाता है। |
| `pickTier` | Pick a tier first. | पहले टियर चुनें। |
| `tierPending` | {code} already has a tier change waiting for approval. | {code} का टियर बदलाव पहले से मंज़ूरी के इंतज़ार में है। |
| `alreadyTier` | {code} is already on that tier. | {code} पहले से उसी टियर पर है। |
| `chemicalUnused` | Nothing was used of {name}. Leave its store item empty. | {name} कुछ इस्तेमाल नहीं हुआ। उसका स्टोर आइटम खाली छोड़ें। |
| `itemNotKg` | {item} is counted in {unit}. Pick a store item counted in kg. | {item} {unit} में गिना जाता है। kg में गिना जाने वाला स्टोर आइटम चुनें। |
| `notAtNitriding` | {code} is not out at nitriding. | {code} नाइट्राइडिंग पर बाहर नहीं है। |
| `pickCopy` | Pick the die copy. | die की कॉपी चुनें। |
| `sectionNoCopies` | This die has no copies. | इस die की कोई कॉपी नहीं है। |
| `copyNotOfDie` | That copy is not of that die. | वह कॉपी इस die की नहीं है। |
| `plantOwned` | {code} is plant-owned. No exception is needed. | {code} प्लांट की अपनी है। छूट की ज़रूरत नहीं। |
| `ownerNoException` | {name} owns {code}. No exception is needed. | {code} का मालिक {name} है। छूट की ज़रूरत नहीं। |
| `exceptionOpen` | {name} already has an open exception on {code}. | {name} की {code} पर छूट पहले से खुली है। |
| `exceptionAsked` | {name} already asked for an exception on {code}. It is waiting for approval. | {name} ने {code} पर छूट पहले ही मांगी है। वह मंज़ूरी के इंतज़ार में है। |
| `exceptionClosed` | This exception can't be closed now. Only an approved exception can be closed, once. | यह छूट अभी बंद नहीं हो सकती। सिर्फ मंज़ूर हुई छूट, एक बार बंद होती है। |
| `notOnTrial` | {code} is not on trial. | {code} ट्रायल पर नहीं है। |
| `releaseManagerOnly` | Only a manager can release a copy without a passed trial. | पास हुए ट्रायल के बिना कॉपी सिर्फ मैनेजर छोड़ सकता है। |
| `releaseWhy` | Say why this copy is released without a trial. | बताएं कि यह कॉपी ट्रायल के बिना क्यों छोड़ी जा रही है। |
| `stillOnPress` | {code} is still on the press. Take the die out and return it first. | {code} अभी press पर है। पहले die बाहर निकालकर लौटाएं। |
| `retireRoleOnly` | Only the die room or a manager can retire a copy. | कॉपी सिर्फ die room या मैनेजर बंद कर सकता है। |
| `pickCustomer` | Pick a customer of this plant. | इस प्लांट का कोई कस्टमर चुनें। |
| `listStale` | This list is out of date. Pull down to reload it. | यह सूची पुरानी हो गई है। नीचे खींचकर फिर लोड करें। |
| `makerNameTaken` | A die maker named {name} already exists. | {name} नाम का die मेकर पहले से है। |
| `nameLetters` | The name needs letters or digits. | नाम में अक्षर या अंक होने चाहिए। |
| `makerOpenJob` | {number} is still with {name}. | {number} अभी {name} के पास है। |
| `makerArchived` | {name} is archived. | {name} आर्काइव है। |
| `jobClosed` | {number} is already closed. | {number} पहले ही बंद हो चुका है। |
| `notTrialRun` | {run} is not a die trial run. | {run} die ट्रायल रन नहीं है। |
| `didNotPress` | {run} did not press {code}. | {run} ने {code} नहीं दबाई। |
| `trialNotClosed` | {run} is not closed yet. Close the trial first. | {run} अभी बंद नहीं हुआ। पहले ट्रायल बंद करें। |
| `trialResult` | {run} has no matching trial result. Check the run. | {run} का ट्रायल नतीजा मेल नहीं खाता। रन देखें। |
| `owned` | This die belongs to {name}. | यह die {name} की है। |
| `ownedOther` | This die belongs to another customer. | यह die किसी दूसरे कस्टमर की है। |
| `poOther` | PO {po} is already on another order of this customer. | PO {po} इस कस्टमर के दूसरे ऑर्डर पर पहले से है। |
| `copyNotLive` | That copy is not a live copy of {section}. | वह कॉपी {section} की चालू कॉपी नहीं है। |
| `onlyBookingConfirm` | Only a booking can be confirmed. This order is {status}. | सिर्फ बुकिंग कन्फर्म हो सकती है। यह ऑर्डर {status} है। |
| `cantClose` | A {status} order can't be closed. | {status} ऑर्डर बंद नहीं हो सकता। |
| `bakiReason` | {kg} kg baki is left on this order. Give a reason to close it. | इस ऑर्डर पर {kg} kg बाकी है। बंद करने का कारण दें। |
| `cantCancel` | A {status} order can't be cancelled. | {status} ऑर्डर रद्द नहीं हो सकता। |
| `cancelCarried` | Bundles, a press plan or a dispatch already carry this order. Close it instead of cancelling. | इस ऑर्डर पर bundle, press प्लान या dispatch है। रद्द करने की जगह इसे बंद करें। |
| `cantChange` | A {status} order can't be changed. | {status} ऑर्डर बदला नहीं जा सकता। |
| `lineWeightLocked` | Line {n} is on a released press plan. Its weight can't change now. | लाइन {n} रिलीज़ हुए press प्लान पर है। उसका वज़न अब नहीं बदल सकता। |
| `listedTwice` | A bundle is listed twice. | एक bundle दो बार लिखा है। |
| `pickOpenOrder` | {order} is {status}. Pick an open order. | {order} {status} है। कोई खुला ऑर्डर चुनें। |
| `pendingRealloc` | {serial} is waiting on a reallocation approval. | {serial} दोबारा बांटने की मंज़ूरी के इंतज़ार में है। |
| `alreadyOnLine` | {serial} is already on {order} line {n}. | {serial} पहले से {order} की लाइन {n} पर है। |
| `heldFor` | {serial} is held for {order} line {n}. Release the hold first. | {serial} {order} की लाइन {n} के लिए रुका है। पहले होल्ड हटाएं। |
| `heldOther` | {serial} is already held for another order line. Release it first. | {serial} पहले से दूसरी ऑर्डर लाइन के लिए रुका है। पहले उसे हटाएं। |
| `alreadyPlantStock` | {serial} is already plant stock. | {serial} पहले से प्लांट स्टॉक है। |
| `bundleDispatched` | {serial} is already dispatched. | {serial} पहले ही dispatch हो चुका है। |
| `bundleVoid` | {serial} is void. | {serial} रद्द (void) है। |
| `onDispatchHeld` | {serial} is held on a dispatch. | {serial} एक dispatch पर रुका है। |
| `onDispatch` | {serial} is on dispatch {code}. Take it off the dispatch first. | {serial} dispatch {code} पर है। पहले उसे dispatch से हटाएं। |
| `diffDie` | {serial} is a different die from that line. | {serial} उस लाइन से अलग die का है। |
| `pickReason` | Pick a reason from the list. | सूची में से कारण चुनें। |
| `reasonNote` | Write a note for this reason. | इस कारण के लिए नोट लिखें। |
| `moveWhy` | Say why the bundles move. | बताएं कि bundle क्यों बदले जा रहे हैं। |
| `cutDiffers` | The cut length differs for {serials}. Pick a reason to move them. | {serials} की कट लंबाई अलग है। उन्हें बदलने के लिए कारण चुनें। |
| `holdOrderClosed` | {order} is {status}. Hold stock for an open order. | {order} {status} है। होल्ड खुले ऑर्डर के लिए ही करें। |
| `holdNotAvailable` | {serial} is not in the yard. Only bundles in the yard can be held. | {serial} यार्ड में नहीं है। सिर्फ यार्ड के bundle होल्ड हो सकते हैं। |
| `onOtherOrder` | {serial} is on another order line. Move it with Reallocate instead. | {serial} दूसरी ऑर्डर लाइन पर है। उसे Reallocate से बदलें। |
| `notHeldFor` | {serials} not held for {order} line {n}. | {serials} {order} की लाइन {n} के लिए रुके नहीं हैं। |
| `savedAsBooking` | A new order is saved as a booking. Confirm it once it is complete. | नया ऑर्डर बुकिंग के रूप में सेव होता है। पूरा होने पर उसे कन्फर्म करें। |
| `saveUsed` | This save was already used for another order, {code}. Reload the order and save again. | यह सेव पहले ही दूसरे ऑर्डर {code} के लिए इस्तेमाल हो चुका है। ऑर्डर फिर लोड करके सेव करें। |
| `editMoveStatus` | An edit can't move the order from {from} to {to}. Use Confirm, Close or Cancel. | बदलाव से ऑर्डर {from} से {to} में नहीं जा सकता। Confirm, Close या Cancel इस्तेमाल करें। |
| `customerLocked` | Bundles are linked to this order. The customer can't change. | इस ऑर्डर से bundle जुड़े हैं। कस्टमर नहीं बदल सकता। |
| `lineTwice` | Line {n} is listed twice. | लाइन {n} दो बार लिखी है। |
| `lineSectionLocked` | Line {n} has bundles. Its die can't change. | लाइन {n} पर bundle हैं। उसकी die नहीं बदल सकती। |
| `lineHasWork` | Line {n} has bundles or dispatches. Change its kg instead of removing it. | लाइन {n} पर bundle या dispatch हैं। हटाने की जगह उसके kg बदलें। |
| `lineOnPlan` | Line {n} is on a press plan. Change its kg instead of removing it. | लाइन {n} press प्लान पर है। हटाने की जगह उसके kg बदलें। |
| `stillNeeds` | This order is {status}. It still needs: | यह ऑर्डर {status} है। इसमें अभी ये बाकी हैं: |
| `enterPieces` | Enter the pieces. | पीस लिखें। |
| `weightMore` | Weight must be more than 0. | वज़न 0 से ज़्यादा होना चाहिए। |
| `ratesOff` | Rates on orders are turned off for this plant. | इस प्लांट में ऑर्डर पर रेट बंद हैं। |
| `planWindow` | The plan must end after it starts and last at most 24 hours. | प्लान शुरू होने के बाद खत्म होना चाहिए और ज़्यादा से ज़्यादा 24 घंटे का हो। |
| `thatPressRetired` | That press is retired. | वह press बंद है। |
| `addPressFirst` | Add a press first. | पहले एक press जोड़ें। |
| `pickPress` | Pick the press for this plan. | इस प्लान के लिए press चुनें। |
| `noKg12` | Line {n} of {order} has no kg/12ft. Enter the kg. | {order} की लाइन {n} का kg/12ft नहीं है। kg लिखें। |
| `nothingLeftToPlan` | Nothing is left to plan on {order} line {n}. | {order} की लाइन {n} पर प्लान करने को कुछ नहीं बचा। |
| `askedMore` | {order} line {n}: {asked} kg asked, only {left} kg is left to plan. | {order} लाइन {n}: {asked} kg मांगा, प्लान के लिए सिर्फ {left} kg बचा है। |
| `addOneLine` | Add at least one order line. | कम से कम एक ऑर्डर लाइन जोड़ें। |
| `trialNoLines` | Only a production plan takes order lines. A trial or sample plan takes none. | सिर्फ़ प्रोडक्शन प्लान में ऑर्डर लाइन जुड़ती है। ट्रायल या सैंपल प्लान में नहीं। |
| `dieTwice` | A die is on the plan twice. Put its lines under one die. | एक die प्लान में दो बार है। उसकी लाइनें एक ही die के नीचे रखें। |
| `lineTwicePlan` | An order line is on the plan twice. | एक ऑर्डर लाइन प्लान में दो बार है। |
| `maxLines` | At most {max} order lines on a plan. | एक प्लान में ज़्यादा से ज़्यादा {max} ऑर्डर लाइन। |
| `confirmFirst` | {order} is {status}. Confirm it before planning. | {order} {status} है। प्लान करने से पहले उसे कन्फर्म करें। |
| `anotherDie` | {order} line {n} is another die. | {order} की लाइन {n} दूसरी die की है। |
| `planDraftOnly` | Only a draft plan can be changed or released. This plan is {status}. | सिर्फ ड्राफ्ट प्लान बदला या रिलीज़ किया जा सकता है। यह प्लान {status} है। |
| `cantGoToPress` | {order} is {status}. It can't go to the press. | {order} {status} है। वह press पर नहीं जा सकता। |
| `planCancelStarted` | A run of this plan has its die issued or has started. It can't be cancelled. | इस प्लान के एक रन में die issue हो चुकी है या वह शुरू हो चुका है। प्लान रद्द नहीं हो सकता। |
| `runsOpen` | Some runs of this plan are not logged or voided yet. | इस प्लान के कुछ रन अभी लॉग या void नहीं हुए। |
| `planCantCancel` | A {status} plan can't be cancelled or closed. | {status} प्लान रद्द या बंद नहीं हो सकता। |
| `nothingToChange` | Nothing to change. | बदलने को कुछ नहीं। |
| `notOnPlan` | That order line is not on this plan. | वह ऑर्डर लाइन इस प्लान पर नहीं है। |
| `alreadyOnPlan` | {order} line {n} is already on this plan. | {order} की लाइन {n} पहले से इस प्लान पर है। |
| `planNeedsLine` | A plan needs at least one order line. Cancel the plan instead. | प्लान में कम से कम एक ऑर्डर लाइन चाहिए। उसकी जगह प्लान रद्द करें। |
| `maxDies` | At most {max} dies on a plan. | एक प्लान में ज़्यादा से ज़्यादा {max} die। |
| `alreadyDecided` | This request was already decided. | इस रिक्वेस्ट पर पहले ही फ़ैसला हो चुका है। |
| `ownRequest` | Someone else has to approve your request. | आपकी रिक्वेस्ट कोई और मंज़ूर करेगा। |
| `minOverMax` | The minimum weight can't be more than the maximum weight. | कम से कम वज़न, ज़्यादा से ज़्यादा वज़न से ज़्यादा नहीं हो सकता। |
| `dieExists` | A die with this series and section code already exists. | इस सीरीज़ और सेक्शन कोड की die पहले से है। |
| `copyOwnerClash` | {code} belongs to another customer. Clear that copy's owner first. | {code} दूसरे ग्राहक की है। पहले उस कॉपी का मालिक हटाएं। |
| `bandExists` | {code} already has a band {min} to {max} kg/12ft at {wall} mm. Add the copy to that band instead. | {code} का {min} से {max} kg/12ft, {wall} mm वाला बैंड पहले से है। कॉपी को उसी बैंड में जोड़ें। |
| `bandRetired` | This band is retired. | यह बैंड बंद है। |
| `copyOnBand` | {code} is still on this band. Lift it to another band first. | {code} अभी इस बैंड पर है। पहले उसे दूसरे बैंड में ले जाएं। |
| `liftWaiting` | A lift to this band is waiting for approval. | इस बैंड में ले जाने की मंज़ूरी बाकी है। |
| `bandRaced` | A copy was put on this band meanwhile. Try again. | इस बीच इस बैंड पर एक कॉपी रखी गई। फिर कोशिश करें। |
| `lineFull` | {line} already has {holders}. Take one back before issuing {copy}. | {line} पर पहले से {holders} हैं। {copy} देने से पहले एक वापस लें। |
| `lineFullDieOut` | {line} already has {holders}. Take one back, or record the die out of {out}, before issuing {copy}. | {line} पर पहले से {holders} हैं। {copy} देने से पहले एक वापस लें, या {out} की die निकलना दर्ज करें। |
| `joinAnd` |  and  |  और  |
| `pickSectionOrCopy` | Pick a die or a die copy. | Die या die की कॉपी चुनें। |
| `copyOtherSection` | This die copy belongs to another die. | यह कॉपी किसी दूसरी die की है। |
| `drawingPdf` | The press drawing must be a PDF, and it belongs to the die. | प्रेस ड्रॉइंग PDF होनी चाहिए, और वह die की होती है। |
| `drawingOfSection` | The press drawing belongs to the die, not to one copy. | प्रेस ड्रॉइंग die की होती है, किसी एक कॉपी की नहीं। |
| `uploadExpired` | This upload has expired. Pick the file again. | यह अपलोड पुराना हो गया। फ़ाइल फिर से चुनें। |
| `fileNotFound` | That file was not found. | वह फ़ाइल नहीं मिली। |
| `fileSaved` | This file is already saved. | यह फ़ाइल पहले से सेव है। |
| `fileNotArrived` | The file has not arrived. Upload it again. | फ़ाइल पहुंची नहीं। फिर से अपलोड करें। |
| `fileNotWhole` | The file did not arrive whole. Upload it again. | फ़ाइल पूरी नहीं पहुंची। फिर से अपलोड करें। |
| `storageOff` | File storage is not set up for this plant yet. | इस प्लांट के लिए फ़ाइल स्टोरेज अभी सेट नहीं है। |
| `fileEmpty` | The file is empty. | फ़ाइल खाली है। |
| `fileTooBig` | This file is larger than {mb} MB. | यह फ़ाइल {mb} MB से बड़ी है। |
| `imageTypes` | Pictures must be JPEG, PNG or WebP. | फ़ोटो JPEG, PNG या WebP होनी चाहिए। |
| `notPdf` | This is not a PDF. | यह PDF नहीं है। |
| `pickFileKind` | Pick a .{kind} file. | .{kind} फ़ाइल चुनें। |
| `unknown` | orrn refused this. Check the details and try again. | orrn ने इसे मना किया। ब्योरा जांचकर फिर कोशिश करें। |

### native (257)

| Key | English | हिंदी |
|---|---|---|
| `scanHint` | Opens the camera to scan a bundle label. | बंडल लेबल स्कैन करने के लिए कैमरा खोलता है। |
| `offlineTitle` | Can't reach orrn | orrn से कनेक्ट नहीं हो पा रहा |
| `offlineBody` | Check the phone's internet connection, then try again. | फ़ोन का इंटरनेट कनेक्शन जांचें, फिर से कोशिश करें। |
| `setPasswordTitle` | Set your own password first | पहले अपना पासवर्ड बनाएं |
| `setPasswordBody` | Your account has a temporary password. Open orrn.in in your phone's browser or on a computer, sign in and set a new password, then come back here. | आपके अकाउंट में अभी अस्थायी पासवर्ड है। फ़ोन के ब्राउज़र में या कंप्यूटर पर orrn.in खोलें, साइन इन करके नया पासवर्ड बनाएं, फिर यहाँ वापस आएं। |
| `staffTitle` | Godseye is on the web | Godseye वेब पर है |
| `staffBody` | Staff accounts don't belong to a plant. Open orrn on a computer to use Godseye. | स्टाफ अकाउंट किसी प्लांट का हिस्सा नहीं होते। Godseye इस्तेमाल करने के लिए कंप्यूटर पर orrn खोलें। |
| `checkAgain` | Check again | फिर से जांचें |
| `tooManyTries` | Too many tries. Wait a minute, then try again. | बहुत बार कोशिश हो गई। एक मिनट रुकें, फिर कोशिश करें। |
| `codeTimedOut` | That took too long. Sign in again. | बहुत देर हो गई। फिर से साइन इन करें। |
| `verifying` | Checking code | कोड जांच रहे हैं |
| `signingOut` | Signing out | साइन आउट हो रहा है |
| `version` | Version {version} | वर्ज़न {version} |
| `codeTooShort` | Enter all 6 digits of the code. | कोड के सभी 6 अंक डालें। |
| `serverTitle` | orrn ran into a problem | orrn में कोई दिक्कत आई |
| `serverBody` | The problem is on orrn's side, not this phone. Try again in a minute. | दिक्कत orrn की तरफ़ से है, इस फ़ोन में नहीं। एक मिनट बाद फिर से कोशिश करें। |
| `saveUnsureTitle` | Not sure it saved | पता नहीं सेव हुआ या नहीं |
| `saveUnsureBody` | orrn didn't confirm this save, so it may have gone through. Check before you try again. | orrn से सेव होने का जवाब नहीं आया, इसलिए हो सकता है यह सेव हो गया हो। दोबारा कोशिश करने से पहले जांच लें। |
| `monthsShort` | Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec | जन॰,फ़र॰,मार्च,अप्रै॰,मई,जून,जुला॰,अग॰,सित॰,अक्टू॰,नव॰,दिस॰ |
| `pack.openSession` | Open session {code} | सेशन {code} खोलें |
| `pack.sessionLine` | {bundles} {bundles:bundle\|bundles}, {kg} kg | {bundles} bundle, {kg} kg |
| `pack.showMore` | Show more sessions | और सेशन दिखाएं |
| `pack.notFound` | This session isn't in this company. | यह सेशन इस कंपनी में नहीं है। |
| `pack.packedAt` | Packed {when} | पैक हुआ {when} |
| `pack.voidNote` | Void bundles are shown here but not counted in the totals. | Void bundle यहां दिखते हैं, पर कुल में नहीं गिने जाते। |
| `pack.bundlesTitle` | Bundles in this session | इस सेशन के bundle |
| `pack.stepOf` | Step {n} of {total}: {name} | चरण {n} / {total}: {name} |
| `pack.pickDie` | Choose a die | Die चुनें |
| `pack.dieSheetTitle` | Choose a die | Die चुनें |
| `pack.dieLoadError` | The dies didn't load. Try again. | Die लोड नहीं हुए। फिर कोशिश करें। |
| `pack.cutLengthMm` | Cut length (mm) | कट लंबाई (mm) |
| `pack.cutLengthError` | Enter a cut length above zero. | शून्य से ज़्यादा कट लंबाई लिखें। |
| `pack.yard` | Yard location | यार्ड की जगह |
| `pack.yardHint` | Where these bundles will be kept. | ये bundle कहां रखे जाएंगे। |
| `pack.yardRequired` | Choose where these bundles go. | चुनें कि ये bundle कहां जाएंगे। |
| `pack.weightError` | Enter the weight in kg, like 52.4 | वज़न kg में लिखें, जैसे 52.4 |
| `pack.piecesError` | Enter whole pieces, like 21 | पूरे पीस लिखें, जैसे 21 |
| `pack.overrideLength` | Cut length for this bundle | इस bundle की कट लंबाई |
| `pack.overrideLengthHint` | Leave blank to use the session cut length. | खाली छोड़ें तो सेशन की कट लंबाई लगेगी। |
| `pack.overridePo` | PO for this bundle | इस bundle का PO |
| `pack.readout` | {value} kg/12ft | {value} kg/12ft |
| `pack.readoutEmpty` | Enter weight and pieces to see kg/12ft. | kg/12ft देखने के लिए वज़न और पीस लिखें। |
| `pack.noBundles` | No bundles yet. Type the first one above. | अभी कोई bundle नहीं। ऊपर पहला bundle लिखें। |
| `pack.updateBundle` | Update bundle | Bundle अपडेट करें |
| `pack.cancelEdit` | Stop editing | बदलना रोकें |
| `pack.bundleLine` | {kg} kg, {pieces} {pieces:piece\|pieces} | {kg} kg, {pieces} पीस |
| `pack.bundleLineOwn` | {kg} kg, {pieces} {pieces:piece\|pieces}, {length}, PO {po} | {kg} kg, {pieces} पीस, {length}, PO {po} |
| `pack.removeTitle` | Remove this bundle? | यह bundle हटाएं? |
| `pack.outOfRange` | {count} {count:bundle is\|bundles are} outside the die range. You can still save. | {count} bundle die की range के बाहर {count:है\|हैं}। फिर भी सेव कर सकते हैं। |
| `pack.resume` | Continue with them | इन्हीं के साथ आगे बढ़ें |
| `pack.resumeLine` | {die}, {count} {count:bundle\|bundles} | {die}, {count} bundle |
| `pack.discardTitle` | Discard unsaved bundles? | बिना सेव किए bundle हटाएं? |
| `pack.discardBody` | They can't be brought back. | ये वापस नहीं आ सकते। |
| `pack.noBundlesToSave` | Add at least one bundle first. | पहले कम से कम एक bundle जोड़ें। |
| `pack.checking` | Checking whether the session saved | देख रहे हैं कि सेशन सेव हुआ या नहीं |
| `pack.checkAgain` | Check again | फिर जांचें |
| `pack.checkFailed` | Couldn't check yet. Check again before you save. | अभी जांच नहीं हो पाई। सेव करने से पहले फिर जांचें। |
| `pack.landed` | That session did save. | वह सेशन सेव हो गया था। |
| `pack.notLanded` | That session did not save. It's safe to save it again. | वह सेशन सेव नहीं हुआ। दोबारा सेव करना सुरक्षित है। |
| `pack.review` | Review | जांचें |
| `pack.editBundles` | Back to bundles | Bundle पर वापस |
| `pack.savePin` | This order line is for another die copy. Pick that copy, or ask the office. | यह order line दूसरी die copy के लिए है। वही copy चुनें, या office से पूछें। |
| `pack.saveRetired` | That die copy can't be packed from. Pick another copy. | उस die copy से pack नहीं हो सकता। दूसरी copy चुनें। |
| `pack.serialsLine` | {count} {count:bundle\|bundles} packed, {from} to {to} | {count} bundle pack हुए, {from} से {to} |
| `pack.serialOne` | 1 bundle packed, {serial} | 1 bundle pack हुआ, {serial} |
| `pack.packAnother` | Pack another session | एक और सेशन pack करें |
| `pack.replayedNote` | This session was already saved. Nothing was packed twice. | यह सेशन पहले ही सेव हो चुका था। कुछ भी दोबारा pack नहीं हुआ। |
| `pack.forOrderLine` | For {order} | {order} के लिए |
| `pack.copyLine` | Copy {code} | Copy {code} |
| `pack.castLine` | Cast {cast} | Cast {cast} |
| `pack.noLines` | No open order lines for this die. These bundles go to plant stock. | इस die की कोई खुली order line नहीं है। ये bundle plant stock में जाएंगे। |
| `pack.sourceChecking` | Checking the die | Die जांच रहे हैं |
| `pack.copyLockedNote` | Locked to the copy this order line asks for. | इस order line की माँगी हुई copy पर लॉक है। |
| `pack.scaleSilent` | A scale is set up but sends nothing. Type the weight and say why. | Scale लगा है पर कुछ भेज नहीं रहा। वज़न टाइप करें और कारण बताएं। |
| `pack.scaleChip` | {state} {kg} kg | {state} {kg} kg |
| `pack.liveChecking` | Checking against the band | Band से जांच रहे हैं |
| `pack.rejectsLine` | Rejects: {count} {count:piece\|pieces} | Reject: {count} पीस |
| `pack.typedBundles` | {count} typed | {count} टाइप किए |
| `pack.saved` | Packed | Pack हुआ |
| `pack.stepSource` | Choose what these bundles are for, then the cut length. | चुनें कि ये bundle किसके लिए हैं, फिर कटाई की लंबाई। |
| `scan.openSettings` | Open settings | सेटिंग्स खोलें |
| `scan.cameraBlockedPhone` | The camera is blocked. Open settings and allow it, or type the serial below. | कैमरा बंद है। सेटिंग्स खोलकर इसे चालू करें, या नीचे serial लिखें। |
| `scan.opened` | Opened | खुला |
| `scan.failed` | Failed | नहीं हुआ |
| `scan.cameraView` | Camera view for scanning bundle labels | bundle के लेबल स्कैन करने वाला कैमरा |
| `dispatch.tabsLabel` | Dispatch status | Dispatch का स्टेटस |
| `dispatch.noShipDate` | No ship date | भेजने की तारीख नहीं |
| `dispatch.tomorrow` | Tomorrow | कल |
| `dispatch.noDate` | No date | तारीख नहीं |
| `dispatch.typedDate` | Type a date | तारीख लिखें |
| `dispatch.dateHint` | Day, month, year, like 15-10-2026. | दिन, महीना, साल, जैसे 15-10-2026। |
| `dispatch.dateInvalid` | That isn't a real date. Use day, month, year, like 15-10-2026. | यह सही तारीख नहीं है। दिन, महीना, साल लिखें, जैसे 15-10-2026। |
| `dispatch.customerRequired` | Pick a customer first. | पहले ग्राहक चुनें। |
| `dispatch.changeCustomer` | Change customer | ग्राहक बदलें |
| `dispatch.customerPicked` | Customer {name} | ग्राहक {name} |
| `dispatch.creating` | Creating | बन रहा है |
| `dispatch.createdNote` | Dispatch created. Add bundles next. | Dispatch बन गया। अब bundle जोड़ें। |
| `dispatch.notesHint` | Optional. Up to 500 letters. | ज़रूरी नहीं। 500 अक्षर तक। |
| `dispatch.bundlesHeading` | Bundles | Bundle |
| `dispatch.bundleMeta` | {pcs} pcs, {length}, {kg} kg | {pcs} पीस, {length}, {kg} kg |
| `dispatch.removeTitle` | Remove {serial}? | {serial} हटाएं? |
| `dispatch.removeBody` | The bundle goes back to stock. | Bundle वापस स्टॉक में चला जाएगा। |
| `dispatch.keepIt` | Keep it | रहने दें |
| `dispatch.addLabel` | Add label | लेबल जोड़ें |
| `dispatch.editLabel` | Edit label | लेबल बदलें |
| `dispatch.clearLabel` | Clear label | लेबल हटाएं |
| `dispatch.groupLabelHint` | Bundles with the same label are listed together on the packing list. | एक ही लेबल वाले bundle पैकिंग लिस्ट में साथ दिखते हैं। |
| `dispatch.stepsLabel` | Dispatch steps | Dispatch के कदम |
| `dispatch.pasteReady` | {count} {count:serial\|serials} ready to add | {count} serial जोड़ने के लिए तैयार |
| `dispatch.pasteChecking` | Checking | जांच हो रही है |
| `dispatch.pastePartial` | {count} {count:serial\|serials} not sent. Check the dispatch, then paste them again. | {count} serial भेजे नहीं {count:गया\|गए}। Dispatch देखें, फिर इन्हें दोबारा पेस्ट करें। |
| `dispatch.pasteAmbiguous` | {serials} match more than one bundle. Type the full number. | {serials} एक से ज़्यादा bundle से मिलते हैं। पूरा नंबर लिखें। |
| `dispatch.pasteAgain` | Paste more | और पेस्ट करें |
| `dispatch.doneMeta` | {customer} | {customer} |
| `dispatch.noPackingList` | No packing list yet. | अभी पैकिंग लिस्ट नहीं है। |
| `dispatch.shareFailed` | Couldn't open the share sheet. Try again. | शेयर नहीं खुला। फिर कोशिश करें। |
| `dispatch.sharing` | Preparing the file | फ़ाइल बन रही है |
| `dispatch.plSection` | {label} · {count} {count:bundle\|bundles} | {label} · {count} bundle |
| `dispatch.plFacts` | {pcs} pcs, {length}, {kg12} kg/12ft | {pcs} पीस, {length}, {kg12} kg/12ft |
| `dispatch.plBand` | Band {band} | बैंड {band} |
| `more.diesCount` | {count} {count:die\|dies} | {count} die |
| `more.customersCount` | {count} {count:customer\|customers} | {count} कस्टमर |
| `more.typeToSearch` | Search by name or code | नाम या कोड से खोजें |
| `more.call` | Call {phone} | {phone} पर कॉल करें |
| `more.mail` | Write to {email} | {email} को लिखें |
| `more.guideMissing` | This guide isn't available. | यह गाइड उपलब्ध नहीं है। |
| `more.guideBack` | Back to guides | गाइड पर वापस जाएं |
| `more.profile` | Your account | आपका अकाउंट |
| `more.appearance` | Appearance | रंग रूप |
| `more.changeOnWeb` | To change these, open orrn on a computer. | इन्हें बदलने के लिए कंप्यूटर पर orrn खोलें। |
| `more.membersEmpty` | No one else is on the team yet. | टीम में अभी कोई और नहीं है। |
| `more.pendingInvite` | {email} as {role} | {email}, {role} के रूप में |
| `more.stockOfDie` | See stock | स्टॉक देखें |
| `invite.subtitle` | Use the email this invite was sent to. | वही ईमेल इस्तेमाल करें जिस पर यह इनवाइट आया है। |
| `invite.checking` | Checking your invite | आपका इनवाइट जांच रहे हैं |
| `invite.wrongEmail` | This invite is for a different email. Sign out, then use the email the invite was sent to. | यह इनवाइट किसी और ईमेल के लिए है। साइन आउट करें, फिर वही ईमेल इस्तेमाल करें जिस पर इनवाइट आया है। |
| `invite.signedOut` | Your session ended. Sign in again, then open the invite link. | आपका सेशन खत्म हो गया। फिर से साइन इन करें, फिर इनवाइट लिंक खोलें। |
| `invite.failed` | orrn didn't answer. Check the connection and try again. | orrn से जवाब नहीं आया। कनेक्शन देखें और फिर कोशिश करें। |
| `invite.twoFactor` | This account asks for a code at sign in. Sign in first, then open the invite link again. | इस अकाउंट में साइन इन पर कोड लगता है। पहले साइन इन करें, फिर इनवाइट लिंक दोबारा खोलें। |
| `invite.goSignIn` | Go to sign in | साइन इन पर जाएं |
| `invite.signedInTitle` | Join as {email} | {email} से जुड़ें |
| `invite.signedInBody` | You are signed in. Accept the invite to join this team with this account. | आप साइन इन हैं। इस अकाउंट से टीम में जुड़ने के लिए इनवाइट स्वीकार करें। |
| `invite.accept` | Join the team | टीम से जुड़ें |
| `invite.joining` | Joining | जुड़ रहे हैं |
| `invite.joined` | You joined the team. | आप टीम से जुड़ गए। |
| `invite.checkAccount` | Check my account | मेरा अकाउंट जांचें |
| `invite.tryAgain` | Try again | फिर कोशिश करें |
| `invite.signOutOther` | Sign out and use another account | साइन आउट करें और दूसरा अकाउंट इस्तेमाल करें |
| `dies.searchLabel` | Find a copy | कॉपी खोजें |
| `dies.found` | {count} {count:copy\|copies} found | {count} कॉपी मिली |
| `dies.noMatch` | No copy matches | कोई कॉपी नहीं मिली |
| `dies.attentionCount` | {count} {count:copy needs\|copies need} attention | {count} कॉपी पर ध्यान चाहिए |
| `dies.filterLabel` | Why it needs attention | ध्यान क्यों चाहिए |
| `dies.partial` | Showing the first {count} copies. Search to find the others. | पहली {count} कॉपी दिख रही हैं। बाकी खोजने के लिए सर्च करें। |
| `dies.showMore` | Show {count} more | {count} और दिखाएं |
| `dies.nothingTitle` | Nothing needs attention | किसी पर ध्यान की जरूरत नहीं |
| `dies.nothingBody` | Every copy is in its band, read this month and in the rack. | हर कॉपी अपने बैंड में है, इस महीने नापी गई है और रैक में है। |
| `dies.reason.above_band` | Above band | बैंड से ऊपर |
| `dies.reason.at_nitriding` | At nitriding | नाइट्राइडिंग पर |
| `dies.reason.at_maker` | At die maker | डाई मेकर के पास |
| `dies.reason.on_trial` | On trial | ट्रायल पर |
| `dies.reason.open_issue` | On a press | प्रेस पर |
| `dies.reason.stale_reading` | No reading in 30 days | 30 दिन से रीडिंग नहीं |
| `dies.reason.never_read` | No reading yet | अभी रीडिंग नहीं |
| `dies.pad.point` | Decimal point | दशमलव बिंदु |
| `dies.saveReading` | Save reading | रीडिंग सेव करें |
| `dies.chemicalsOnWeb` | Chemicals are written on the card on the web. | केमिकल वेब पर कार्ड में लिखे जाते हैं। |
| `dies.addMakerOnWeb` | Add one on the web. | वेब पर जोड़ें। |
| `dies.issueTitle` | Issue {code} | {code} इश्यू करें |
| `dies.issueToRun` | Issue to {run} | {run} के लिए इश्यू करें |
| `dies.fileFailed` | The file didn't open. Try again. | फाइल नहीं खुली। फिर कोशिश करें। |
| `dies.openFile` | Open | खोलें |
| `dies.readOnly` | These details are changed on the card on the web. | ये जानकारी वेब पर कार्ड में बदली जाती है। |
| `dies.waitingTitle` | Waiting for a die | डाई का इंतजार |
| `dies.waitingEmpty` | No press run is waiting | कोई प्रेस रन इंतजार में नहीं है |
| `dies.waitingEmptyBody` | Runs released from a press plan show here until a copy is issued. | प्रेस प्लान से रिलीज हुए रन कॉपी इश्यू होने तक यहां दिखते हैं। |
| `dies.needsDie` | Needs a die | डाई चाहिए |
| `orders.lineOf` | Line {n} of {total} | लाइन {n} / {total} |
| `orders.review` | Review | जांच |
| `orders.toReview` | Review the order | ऑर्डर की जांच करें |
| `orders.changeDie` | Change die | डाई बदलें |
| `orders.incomplete` | Not complete | अधूरी |
| `tabs.press` | Press | प्रेस |
| `gate.checking` | Checking this version | यह वर्जन जांच रहे हैं |
| `gate.blockedTitle` | orrn can't open on this phone | orrn इस फोन पर नहीं खुल सकता |
| `gate.blocked.below_min_build` | This version of orrn is too old. Install the latest version, then open it again. | orrn का यह वर्जन बहुत पुराना है। नया वर्जन इंस्टॉल करें, फिर दोबारा खोलें। |
| `gate.blocked.revoked` | This phone has been turned off for this plant. Ask your admin to turn it back on. | इस फोन को इस प्लांट के लिए बंद कर दिया गया है। एडमिन से इसे फिर चालू करने को कहें। |
| `gate.blocked.never_checked` | orrn could not check this version. Connect to the internet and check again. | orrn इस वर्जन को जांच नहीं सका। इंटरनेट से जुड़ें और फिर जांचें। |
| `gate.blocked.grace_expired` | orrn has not been able to check for updates for over 24 hours. Connect to the internet and check again. | orrn 24 घंटे से ज्यादा समय से अपडेट नहीं जांच सका। इंटरनेट से जुड़ें और फिर जांचें। |
| `gate.blocked.last_blocked` | This version of orrn cannot open. Connect to the internet and check again. | orrn का यह वर्जन नहीं खुल सकता। इंटरनेट से जुड़ें और फिर जांचें। |
| `gate.blocked.unreadable_build` | orrn could not read its own version on this phone. Install the latest version again. | orrn इस फोन पर अपना वर्जन नहीं पढ़ सका। नया वर्जन दोबारा इंस्टॉल करें। |
| `gate.latest` | The latest version is {version}. | नया वर्जन {version} है। |
| `gate.getLatest` | Get the latest version | नया वर्जन लें |
| `gate.graceNote` | Could not check for updates. This version can still open until {time}. | अपडेट नहीं जांच सके। यह वर्जन {time} तक खुल सकता है। |
| `web.title` | Open on the web | वेब पर खोलें |
| `web.hint` | Opens in your browser | ब्राउजर में खुलता है |
| `web.team` | Team | टीम |
| `web.shifts` | Shifts | शिफ्ट |
| `web.standards` | Standards | स्टैंडर्ड |
| `web.backup` | Backup | बैकअप |
| `press.linesHeading` | Press lines | Press लाइनें |
| `press.noLines` | No press is set up yet. Ask the office to add one. | अभी कोई press सेट नहीं है। office से जुड़वाएं। |
| `press.stationNote` | Start, stop and counting are done on the tablet at the press. This phone shows what is happening. | Start, stop और गिनती press के पास वाले टैबलेट पर होती है। यह फोन बस दिखाता है कि क्या चल रहा है। |
| `press.lineIdle` | Idle | खाली |
| `press.lineRunning` | Running {number} | {number} चल रहा है |
| `press.lineQueued` | {count} {count:run\|runs} waiting | {count} रन इंतज़ार में |
| `press.lineDowntime` | Press stopped | Press बंद है |
| `press.atTablet` | Use the tablet at the press to start, stop or count this run. | इस रन को शुरू, बंद या गिनने के लिए press के पास वाला टैबलेट इस्तेमाल करें। |
| `press.gateUnknown` | Something else is missing before this run can be logged. | इस रन को लॉग करने से पहले कुछ और बाकी है। |
| `press.onPress` | On the press now | अभी press पर |
| `press.urgent` | Urgent | ज़रूरी |
| `press.jobCopy` | Copy {code} | Copy {code} |
| `press.jobNoCopy` | No die copy yet | अभी die copy नहीं |
| `press.jobLine` | {order}, {length}, {pcs} pcs, {kg} kg | {order}, {length}, {pcs} पीस, {kg} kg |
| `press.jobTotals` | {pcs} pcs, {kg} kg | {pcs} पीस, {kg} kg |
| `press.jobPressed` | {kg} kg already pressed | {kg} kg पहले ही press हुआ |
| `press.jobHeading` | Orders on this die | इस die के order |
| `press.line` | Press | Press |
| `press.dieCopy` | Die copy | Die copy |
| `press.startedAt` | Started | शुरू |
| `press.stoppedAt` | Stopped | बंद |
| `press.runningSince` | Since {time} | {time} से |
| `press.figuresLive` | Figures so far | अब तक के आंकड़े |
| `press.figuresLogged` | Logged figures | लॉग किए आंकड़े |
| `press.gatesHeading` | Before the supervisor can log this run | सुपरवाइज़र के इस रन को लॉग करने से पहले |
| `press.downtimeWhy` | Why did the press stop? | Press क्यों रुका? |
| `press.downtimeSince` | Since {time}, {minutes} min | {time} से, {minutes} मिनट |
| `press.downtimeStarted` | Downtime started | डाउनटाइम शुरू हुआ |
| `press.downtimeStopped` | Downtime stopped, {minutes} min | डाउनटाइम बंद हुआ, {minutes} मिनट |
| `press.downtimeTotal` | {minutes} min stopped on this run | इस रन पर {minutes} मिनट बंद रहा |
| `press.handoverTitle` | Handover | हैंडओवर |
| `press.handoverSave` | Save handover | हैंडओवर सेव करें |
| `press.handoverSaved` | Handover saved | हैंडओवर सेव हुआ |
| `press.nobody` | Nobody | कोई नहीं |
| `press.scanOpened` | Opened run {number} | रन {number} खुला |
| `press.scanNoRun` | No run is waiting for this die copy. Its card is opening instead. | इस die copy के लिए कोई रन इंतज़ार में नहीं है। इसके बजाय इसका card खुल रहा है। |
| `press.planHeading` | Press plan | प्रेस प्लान |
| `press.planToday` | {kg} kg, {runs} {runs:run\|runs}, {min} min stopped | {kg} kg, {runs} रन, {min} मिनट बंद |
| `press.planNone` | No plan is released to the press. | प्रेस को कोई प्लान रिलीज़ नहीं हुआ। |
| `press.planKg` | {pressed} of {planned} kg | {planned} में से {pressed} kg |
| `press.planPcs` | {pressed} of {planned} pcs | {planned} में से {pressed} pcs |
| `press.planNotStarted` | Not started | शुरू नहीं हुआ |
| `press.errors.dieElsewhere` | The die issued is for another run or press. Ask the die room. | जो die दी गई है वह किसी दूसरे रन या press की है। die room से पूछें। |
| `press.errors.downtimeRunning` | This press already has downtime running. Stop it first. | इस press पर डाउनटाइम पहले से चल रहा है। पहले उसे बंद करें। |
| `press.errors.noteNeeded` | Add a note for Other. | Other के लिए नोट लिखें। |
| `press.errors.pickReason` | Pick a reason from the list. | सूची से कारण चुनें। |
| `press.errors.runClosed` | That run is closed. | वह रन बंद हो चुका है। |
| `press.errors.otherPress` | That run is on another press. | वह रन दूसरे press पर है। |
| `press.errors.retired` | {code} is retired. | {code} बंद कर दिया गया है। |
| `press.errors.notMember` | That person is not on this plant's team. | वह व्यक्ति इस प्लांट की टीम में नहीं है। |
| `press.errors.operatorRole` | The operator must be someone who runs the press. | ऑपरेटर कोई ऐसा होना चाहिए जो press चलाता हो। |
| `press.errors.supervisorRole` | The supervisor must be someone who can log runs. | सुपरवाइज़र कोई ऐसा होना चाहिए जो रन लॉग कर सके। |
| `press.errors.changed` | This changed meanwhile and was not saved. Pull down to reload. | यह इस बीच बदल गया और सेव नहीं हुआ। नीचे खींचकर फिर लोड करें। |
| `press.errors.handoverClosed` | {number} is closed, so its people can't change. | {number} बंद है, इसलिए इसके लोग नहीं बदल सकते। |
| `press.errors.notFound` | That press or run isn't in this company. | वह press या रन इस कंपनी में नहीं है। |
| `stock.yard` | Yard | यार्ड |
| `stock.allYards` | All yards | सभी यार्ड |

### ui (7)

| Key | English | हिंदी |
|---|---|---|
| `stepOf` | Step {n} of {total} | कदम {n} / {total} |
| `stepDone` | done | हो गया |
| `stepCurrent` | current step | अभी का कदम |
| `searching` | Searching | खोज रहे हैं |
| `recent` | Recent | हाल के |
| `pages` | Pages | पेज |
| `pageRangeOpen` | {from}-{to} | {from}-{to} |

### comingSoon (4)

| Key | English | हिंदी |
|---|---|---|
| `foundry` | Foundry | फाउंड्री |
| `ageing` | Ageing | एजिंग |
| `title` | This module is being built on another machine | यह मॉड्यूल दूसरी मशीन पर बन रहा है |
| `body` | It is not ready in this app yet. Nothing here is saved. | यह अभी इस ऐप में तैयार नहीं है। यहाँ कुछ भी सेव नहीं होता। |

### charts (28)

| Key | English | हिंदी |
|---|---|---|
| `showTable` | Show table | टेबल दिखाएं |
| `hideTable` | Hide table | टेबल छिपाएं |
| `legend` | Legend | संकेत |
| `loading` | Loading chart | चार्ट लोड हो रहा है |
| `emptyTitle` | No data for this period | इस अवधि का कोई डेटा नहीं |
| `emptyBody` | Pick a longer period to see more. | ज़्यादा देखने के लिए लंबी अवधि चुनें। |
| `errorTitle` | This chart didn't load | यह चार्ट लोड नहीं हुआ |
| `errorBody` | Check the connection and try again. | कनेक्शन जांचें और फिर से कोशिश करें। |
| `other` | Other | बाकी |
| `rank` | Rank | रैंक |
| `name` | Name | नाम |
| `share` | Share | हिस्सा |
| `movement` | Movement | बदलाव |
| `movedUp` | Up {count} | {count} ऊपर |
| `movedDown` | Down {count} | {count} नीचे |
| `movedUpLong` | Up {count} {count:place\|places} from the previous period | पिछली अवधि से {count} {count:स्थान\|स्थान} ऊपर |
| `movedDownLong` | Down {count} {count:place\|places} from the previous period | पिछली अवधि से {count} {count:स्थान\|स्थान} नीचे |
| `noChange` | Same | वही |
| `noChangeLong` | Same place as the previous period | पिछली अवधि जैसा ही स्थान |
| `isNew` | New | नया |
| `isNewLong` | New this period | इस अवधि में नया |
| `noValue` | No data | डेटा नहीं |
| `soFarLabel` | {label}, so far | {label}, अब तक |
| `shareOfTotal` | {share} of total | कुल का {share} |
| `unitThousand` | k | k (check) |
| `unitLakh` | L | L (check) |
| `unitCrore` | Cr | Cr (check) |
| `sparkSummary` | {label}: {first} to {last}, high {max}, low {min} | {label}: {first} से {last}, सबसे ज़्यादा {max}, सबसे कम {min} |

Please check, Lalubhai:

- `unitThousand`: Chart axis short form for thousand. Kept as k for now. Should it be हज़ार or something shorter?
- `unitLakh`: Chart axis short form for lakh (1.5L). Kept as L for now. Should it be लाख?
- `unitCrore`: Chart axis short form for crore (1.2Cr). Kept as Cr for now. Should it be करोड़?

### purchase (206)

| Key | English | हिंदी |
|---|---|---|
| `title` | Purchase | खरीद |
| `subtitle` | Scrap lots from the kanta to the scrap store | स्क्रैप के लॉट, कांटे से स्क्रैप स्टोर तक |
| `newLot` | New lot | नया लॉट |
| `lotStatus.booking` | Booked | बुक हुआ |
| `lotStatus.unload` | Unloading | उतराई में |
| `lotStatus.ok` | OK | OK |
| `lotStatus.cancelled` | Cancelled | कैंसल |
| `flag.shortWithoutNote` | Needs a note | नोट चाहिए |
| `flag.notePending` | Note waiting | नोट इंतज़ार में |
| `filter.label` | Show | दिखाएं |
| `filter.all` | All | सभी |
| `filter.booking` | Booked | बुक हुए |
| `filter.unload` | Unloading | उतराई में |
| `filter.ok` | OK | OK |
| `kpi.atKanta` | At the kanta | कांटे पर |
| `kpi.atKantaMeta` | Booked or unloading | बुक हुए या उतराई में |
| `kpi.lots` | {count:lot\|lots} | {count:लॉट\|लॉट} |
| `kpi.inStock` | Scrap in stock | स्टॉक में स्क्रैप |
| `kpi.inStockMeta` | All scrap stores | सभी स्क्रैप स्टोर |
| `kpi.error` | This figure didn't load. | यह आंकड़ा लोड नहीं हुआ। |
| `list.label` | Scrap lots | स्क्रैप लॉट |
| `list.lot` | Lot | लॉट |
| `list.vendor` | Vendor | पार्टी |
| `list.material` | Material | माल |
| `list.party` | Party kg | पार्टी kg |
| `list.ours` | Our kg | हमारा kg |
| `list.difference` | Difference | फ़र्क |
| `list.status` | Status | स्थिति |
| `list.emptyTitle` | No lots yet | अभी कोई लॉट नहीं |
| `list.emptyBody` | Weigh the first truck and its lot shows up here. | पहली गाड़ी तौलें, उसका लॉट यहां दिखेगा। |
| `list.emptyFilteredTitle` | No lots here | यहां कोई लॉट नहीं |
| `list.emptyFilteredBody` | Nothing matches this filter. | इस फ़िल्टर में कुछ नहीं मिला। |
| `list.showAll` | Show all lots | सभी लॉट दिखाएं |
| `list.error` | The lots didn't load. Check the connection and try again. | लॉट लोड नहीं हुए। कनेक्शन देखें और फिर से कोशिश करें। |
| `material` | {item}, grade {grade} | {item}, ग्रेड {grade} |
| `diff.even` | Same weight | वज़न बराबर |
| `diff.over` | {kg} kg over | {kg} kg ज़्यादा |
| `diff.within` | {kg} kg short, within {pct} | {kg} kg कम, {pct} के अंदर |
| `diff.short` | {kg} kg short, beyond {pct} | {kg} kg कम, {pct} से ज़्यादा |
| `diff.incomplete` | Not weighed on our kanta | हमारे कांटे पर नहीं तौला |
| `diffWord.even` | Same weight | वज़न बराबर |
| `diffWord.over` | Over | ज़्यादा |
| `diffWord.within` | Short, within {pct} | कम, {pct} के अंदर |
| `diffWord.short` | Short, beyond {pct} | कम, {pct} से ज़्यादा |
| `diffWord.incomplete` | Not weighed on our kanta | हमारे कांटे पर नहीं तौला |
| `tolerance` | Tolerance {kg} kg ({pct}) | छूट {kg} kg ({pct}) |
| `charts.rateTitle` | Rate paid | दिया गया रेट |
| `charts.rateSubtitle` | Average ₹ per kg by month for the most bought items, this month so far | सबसे ज़्यादा खरीदे माल का महीने वार औसत ₹ प्रति kg, इस महीने अब तक |
| `charts.rateLabel` | Rate paid, rupees per kg by month | दिया गया रेट, महीने वार रुपये प्रति kg |
| `charts.month` | Month | महीना |
| `charts.vendorTitle` | Kg bought by vendor | पार्टी वार खरीदा kg |
| `charts.vendorSubtitle` | Party kg in the last 6 months, top 8 and the rest | पिछले 6 महीने का पार्टी kg, टॉप 8 और बाकी |
| `charts.vendorLabel` | Vendors by kg bought | खरीदे kg के हिसाब से पार्टियां |
| `charts.bought` | Bought | खरीदा |
| `charts.otherVendors` | Other vendors | बाकी पार्टियां |
| `charts.truncated` | These charts count only the first 2,000 lots of the 6 months, so the latest weeks are missing. | ये चार्ट 6 महीनों के पहले 2,000 लॉट ही गिनते हैं, इसलिए सबसे नए हफ़्ते छूट गए हैं। |
| `new.title` | New lot | नया लॉट |
| `new.subtitle` | A truck at the kanta | कांटे पर आई गाड़ी |
| `new.steps.vendor` | Vendor | पार्टी |
| `new.steps.material` | Material | माल |
| `new.steps.weights` | Weights | वज़न |
| `new.steps.book` | Book | बुक |
| `new.vendor` | Vendor | पार्टी |
| `new.vendorHint` | Search by name or any spelling the book uses. | नाम से या बुक में लिखे किसी भी नाम से खोजें। |
| `new.vendorPlaceholder` | Search vendors | पार्टी खोजें |
| `new.addVendor` | Add new vendor | नई पार्टी जोड़ें |
| `new.addVendorTitle` | Add vendor | पार्टी जोड़ें |
| `new.addVendorBody` | A manager confirms new vendors later. | नई पार्टी को बाद में मैनेजर पक्का करेंगे। |
| `new.vendorName` | Vendor name | पार्टी का नाम |
| `new.vendorCity` | City | शहर |
| `new.vendorPhone` | Phone | फ़ोन |
| `new.saveVendor` | Add vendor | पार्टी जोड़ें |
| `new.vendorAdded` | Vendor added | पार्टी जुड़ गई |
| `new.draftVendor` | New | नई |
| `new.usual` | Usually sells | आम तौर पर बेचती है |
| `new.usualPick` | {item} at {rate} per kg | {item}, {rate} प्रति kg |
| `new.item` | Material | माल |
| `new.grade` | Grade | ग्रेड |
| `new.rate` | Rate (₹ per kg) | रेट (₹ प्रति kg) |
| `new.origin` | Origin | कहां से |
| `new.originHint` | Where the scrap comes from, like local or Dubai. | स्क्रैप कहां से आया, जैसे लोकल या दुबई। |
| `new.dross` | Dross (%) | ड्रॉस (%) |
| `new.party` | Party kanta (kg) | पार्टी का कांटा (kg) |
| `new.partyHint` | The weight on the party's slip. | पार्टी की पर्ची पर लिखा वज़न। |
| `new.fc` | Our kanta (kg) | हमारा कांटा (kg) |
| `new.fcHint` | Leave it empty if the truck is not weighed here yet. | गाड़ी यहां अभी नहीं तौली तो खाली छोड़ें। |
| `new.difference` | Difference | फ़र्क |
| `new.noteTitle` | Debit note | डेबिट नोट |
| `new.noteBody` | {kg} kg short, more than {pct}. The lot can't go OK until a debit note covers at least {min} kg. | {kg} kg कम, {pct} से ज़्यादा। जब तक डेबिट नोट कम से कम {min} kg नहीं ढकता, लॉट OK नहीं होगा। |
| `new.raiseNote` | Raise the debit note now | डेबिट नोट अभी बनाएं |
| `new.noteKg` | Kg to debit | डेबिट करने वाले kg |
| `new.noteKgHint` | At least {min} kg. | कम से कम {min} kg। |
| `new.noteKgRange` | From {min} kg up to the short, {max} kg. | {min} kg से कमी तक, {max} kg। |
| `new.noteKgMax` | Up to the short still open, {max} kg. | बची हुई कमी तक, {max} kg। |
| `new.summaryNote` | Debit note | डेबिट नोट |
| `new.fixCount` | {count} {count:thing\|things} to fix on this step | इस कदम पर {count} {count:चीज़\|चीज़ें} ठीक करनी हैं |
| `new.saveUnsure` | orrn didn't answer, so the lot may have saved. Check the lot list before you save it again. | orrn से जवाब नहीं आया, हो सकता है लॉट सेव हो गया हो। दोबारा सेव करने से पहले लॉट की सूची देखें। |
| `new.openLots` | Open lots | लॉट देखें |
| `new.mastersError` | The scrap items didn't load. Check the connection and try again. | स्क्रैप आइटम लोड नहीं हुए। कनेक्शन देखें और फिर से कोशिश करें। |
| `new.bori` | Bori deduction (kg) | बोरी कटौती (kg) |
| `new.boriHint` | Weight of the bags, when the party is charged for them. | बोरियों का वज़न, अगर पार्टी से काटना है। |
| `new.noteText` | Note for the manager | मैनेजर के लिए नोट |
| `new.noteOffice` | The office raises the debit note before this lot can go OK. | लॉट OK होने से पहले ऑफ़िस डेबिट नोट बनाएगा। |
| `new.billBook` | Bill book | बिल बुक |
| `new.billBookHint` | WB is the w-bill book. UB is a lot partly in the w-bill book. | WB यानी w-bill बुक। UB यानी लॉट का कुछ हिस्सा w-bill बुक में। |
| `new.partyBillNo` | Party bill number | पार्टी का बिल नंबर |
| `new.vehicleNo` | Vehicle number | गाड़ी नंबर |
| `new.date` | Lot date | लॉट की तारीख |
| `new.notes` | Notes | नोट |
| `new.summary` | This lot | यह लॉट |
| `new.notChosen` | Not chosen | चुना नहीं |
| `new.save` | Save lot | लॉट सेव करें |
| `new.saved` | Lot {number} saved | लॉट {number} सेव हो गया |
| `new.savedWithNote` | Lot {number} saved. Note {note} sent for approval. | लॉट {number} सेव हो गया। नोट {note} मंज़ूरी के लिए भेजा। |
| `new.noteFailed` | Lot {number} saved, but the debit note didn't go through: {error} | लॉट {number} सेव हो गया, पर डेबिट नोट नहीं बना: {error} |
| `new.noItems` | No scrap items yet. A manager adds them in Masters. | अभी कोई स्क्रैप माल नहीं। मैनेजर इसे Masters में जोड़ेंगे। |
| `billBooks.main` | Main | मुख्य |
| `billBooks.wb` | WB | WB |
| `billBooks.ub` | UB | UB |
| `detail.party` | Party kanta | पार्टी का कांटा |
| `detail.ours` | Our kanta | हमारा कांटा |
| `detail.difference` | Difference | फ़र्क |
| `detail.facts` | Lot details | लॉट की जानकारी |
| `detail.nextStep` | Next step | अगला कदम |
| `detail.vendor` | Vendor | पार्टी |
| `detail.material` | Material | माल |
| `detail.rate` | Rate | रेट |
| `detail.amount` | Amount | रकम |
| `detail.payable` | Payable | देय वज़न |
| `detail.billBook` | Bill book | बिल बुक |
| `detail.partyBillNo` | Party bill number | पार्टी का बिल नंबर |
| `detail.vehicleNo` | Vehicle | गाड़ी |
| `detail.origin` | Origin | कहां से |
| `detail.dross` | Dross | ड्रॉस |
| `detail.date` | Lot date | लॉट की तारीख |
| `detail.notSet` | Not set | नहीं डाला |
| `detail.perKg` | {rate} per kg | {rate} प्रति kg |
| `detail.perKgUnit` | per kg | प्रति kg |
| `detail.notesTitle` | Debit and credit notes | डेबिट और क्रेडिट नोट |
| `detail.noNotes` | No notes on this lot. | इस लॉट पर कोई नोट नहीं। |
| `detail.noteType.debit` | Debit note | डेबिट नोट |
| `detail.noteType.credit` | Credit note | क्रेडिट नोट |
| `detail.noteReason.weight` | Weight | वज़न |
| `detail.noteReason.grade` | Grade | ग्रेड |
| `detail.noteKg` | {kg} kg | {kg} kg |
| `detail.noteBori` | Bori {kg} kg | बोरी {kg} kg |
| `detail.stockTitle` | Scrap stock | स्क्रैप स्टॉक |
| `detail.stockNone` | Goes into scrap stock when it is marked OK. | OK होने पर स्क्रैप स्टॉक में जाएगा। |
| `detail.stockNever` | This lot never went into stock. | यह लॉट कभी स्टॉक में नहीं आया। |
| `detail.stockIn` | {kg} kg in at {location} | {location} में {kg} kg आया |
| `detail.stockOut` | {kg} kg out at {location} | {location} से {kg} kg गया |
| `detail.markUnload` | Mark unloading | उतराई चालू करें |
| `detail.markedUnload` | Marked unloading | उतराई चालू की |
| `detail.markOk` | Mark OK | OK करें |
| `detail.markedOk` | Marked OK. {kg} kg in scrap stock at {location}. | OK हो गया। {location} में {kg} kg स्क्रैप स्टॉक में। |
| `detail.weigh` | Enter our kanta weight | हमारे कांटे का वज़न डालें |
| `detail.editWeights` | Edit weights | वज़न बदलें |
| `detail.weightsLocked` | A note on the weight is open, so the weights are locked. | वज़न पर नोट खुला है, इसलिए वज़न नहीं बदलेगा। |
| `detail.saveWeights` | Save weights | वज़न सेव करें |
| `detail.weightsSaved` | Weights saved | वज़न सेव हो गया |
| `detail.raiseNote` | Raise D/C note | D/C नोट बनाएं |
| `detail.noteSheetTitle` | Raise D/C note | D/C नोट बनाएं |
| `detail.noteSheetBody` | A manager approves it before it counts. | मैनेजर की मंज़ूरी के बाद ही गिना जाएगा। |
| `detail.type` | Type | किस्म |
| `detail.reason` | Reason | वजह |
| `detail.kgDiff` | Kg difference | kg का फ़र्क |
| `detail.amountOptional` | Amount (₹) | रकम (₹) |
| `detail.amountHint` | Leave it empty to use kg times the lot's rate. | खाली छोड़ें तो kg गुणा लॉट का रेट लगेगा। |
| `detail.sendNote` | Send for approval | मंज़ूरी के लिए भेजें |
| `detail.noteSent` | Note {number} sent for approval | नोट {number} मंज़ूरी के लिए भेजा |
| `detail.blockedWeigh` | Weigh the truck on our kanta before marking it OK. | OK करने से पहले गाड़ी हमारे कांटे पर तौलें। |
| `detail.blockedShort` | {kg} kg short, beyond {pct}. A debit note must cover at least {min} kg before OK. | {kg} kg कम, {pct} से ज़्यादा। OK से पहले डेबिट नोट कम से कम {min} kg ढके। |
| `detail.blockedShortOffice` | {kg} kg short, beyond {pct}. Ask the office to raise a debit note for at least {min} kg. | {kg} kg कम, {pct} से ज़्यादा। ऑफ़िस से कम से कम {min} kg का डेबिट नोट बनवाएं। |
| `detail.okShortWithoutNote` | In stock, but {kg} kg short, beyond {pct}, and no live debit note covers it. Raise one for at least {min} kg. | स्टॉक में है, पर {kg} kg कम है, {pct} से ज़्यादा, और कोई चालू डेबिट नोट इसे नहीं ढकता। कम से कम {min} kg का नोट बनाएं। |
| `detail.okShortOffice` | In stock, but {kg} kg short, beyond {pct}, and no live debit note covers it. Ask the office to raise one for at least {min} kg. | स्टॉक में है, पर {kg} kg कम है, {pct} से ज़्यादा, और कोई चालू डेबिट नोट इसे नहीं ढकता। ऑफ़िस से कम से कम {min} kg का नोट बनवाएं। |
| `detail.coveredBy` | The short is covered by {notes}. | कमी {notes} से ढकी है। |
| `detail.noteCovers` | The debit notes cover the short. The lot can go OK. | डेबिट नोट कमी को ढकते हैं। लॉट OK हो सकता है। |
| `detail.store` | Scrap store | स्क्रैप स्टोर |
| `detail.cancel` | Cancel lot | लॉट कैंसल करें |
| `detail.cancelTitle` | Cancel this lot? | यह लॉट कैंसल करें? |
| `detail.cancelBody` | It stays in the book as cancelled. A lot in stock comes out of scrap stock. | बुक में कैंसल लिखा रहेगा। स्टॉक में आया लॉट स्क्रैप स्टॉक से निकल जाएगा। |
| `detail.cancelReason` | Reason | वजह |
| `detail.keep` | Keep lot | लॉट रखें |
| `detail.cancelled` | Lot cancelled | लॉट कैंसल हो गया |
| `detail.cancelledBecause` | Cancelled: {reason} | कैंसल: {reason} |
| `detail.notFound` | This lot doesn't exist or was removed. | यह लॉट नहीं है या हटा दिया गया। |
| `detail.error` | This lot didn't load. Check the connection and try again. | यह लॉट लोड नहीं हुआ। कनेक्शन देखें और फिर से कोशिश करें। |
| `errors.vendor` | Choose the vendor, or add a new one. | पार्टी चुनें, या नई जोड़ें। |
| `errors.item` | Choose the material. | माल चुनें। |
| `errors.grade` | Choose the grade. | ग्रेड चुनें। |
| `errors.rate` | Enter the rate in rupees per kg, like 198.50. | रेट रुपये प्रति kg में डालें, जैसे 198.50। |
| `errors.rateHigh` | That rate is above ₹10,000 per kg. Check it. | यह रेट ₹10,000 प्रति kg से ज़्यादा है। जांच लें। |
| `errors.dross` | Enter dross as a percent from 0 to 100. | ड्रॉस 0 से 100 के बीच प्रतिशत में डालें। |
| `errors.origin` | Keep the origin under 80 characters. | कहां से 80 अक्षर से कम रखें। |
| `errors.party` | Enter the weight on the party's slip in kg. | पार्टी की पर्ची का वज़न kg में डालें। |
| `errors.fc` | Enter our kanta weight in kg, or leave it empty. | हमारे कांटे का वज़न kg में डालें, या खाली छोड़ें। |
| `errors.tooHeavy` | That is more than 100 tonnes. Check the weight. | यह 100 टन से ज़्यादा है। वज़न जांच लें। |
| `errors.noteTooSmall` | The note must cover at least the short beyond the tolerance. | नोट कम से कम छूट से ज़्यादा वाली कमी ढके। |
| `errors.noteTooBig` | The note can't be more than the party weight. | नोट पार्टी के वज़न से ज़्यादा नहीं हो सकता। |
| `errors.noteOverShort` | A weight debit can't be more than the short. Lower the kg. | वज़न का डेबिट कमी से ज़्यादा नहीं हो सकता। kg कम करें। |
| `errors.bori` | The bori deduction must be less than our kanta weight. | बोरी कटौती हमारे कांटे के वज़न से कम हो। |
| `errors.date` | Pick the lot date. | लॉट की तारीख चुनें। |
| `errors.vehicle` | Keep the vehicle number under 20 characters. | गाड़ी नंबर 20 अक्षर से कम रखें। |
| `errors.billNo` | Keep the bill number under 60 characters. | बिल नंबर 60 अक्षर से कम रखें। |
| `errors.notes` | Keep the notes under 500 characters. | नोट 500 अक्षर से कम रखें। |
| `errors.reason` | Write why the lot is cancelled. | लिखें कि लॉट क्यों कैंसल हो रहा है। |

### approvals (90)

| Key | English | हिंदी |
|---|---|---|
| `title` | Approvals | मंज़ूरी |
| `subtitle` | Requests that need a second person | जिन कामों पर दूसरे व्यक्ति की मंज़ूरी चाहिए |
| `waitingTitle` | Waiting for a decision | फ़ैसले के इंतज़ार में |
| `waitingUnit` | {count:request\|requests} | {count:रिक्वेस्ट\|रिक्वेस्ट} |
| `filter.label` | Show | दिखाएं |
| `filter.pending` | Waiting | इंतज़ार में |
| `filter.approved` | Approved | मंज़ूर |
| `filter.rejected` | Rejected | नामंज़ूर |
| `kindFilter` | Kind | किस्म |
| `allKinds` | All kinds | सभी किस्म |
| `kind.dc_note` | Debit or credit note | डेबिट या क्रेडिट नोट |
| `kind.cast_close` | Cast close | कास्ट बंद करना |
| `kind.die_rerank` | Die tier change | Die का टियर बदलना |
| `kind.dispatch_overdraw` | Dispatch over the order | ऑर्डर से ज़्यादा dispatch |
| `kind.phantom_void` | Void after a count | गिनती के बाद void |
| `kind.die_owner_override` | Use another customer's die | दूसरे ग्राहक की die चलाना |
| `kind.order_reallocate` | Move bundles to another customer | Bundle दूसरे ग्राहक को देना |
| `kind.press_time` | Press run times | प्रेस रन का समय |
| `kind.press_reopen` | Reopen a press run | प्रेस रन फिर खोलना |
| `kind.ageing_override` | Ageing override | एजिंग की छूट |
| `kind.press_late_entry` | Press run entered late | बाद में भरा गया प्रेस रन |
| `kind.melt_correct` | Correct a locked melt | लॉक किया melt सुधारना |
| `subject.dcDebit` | Debit note {number} on {lot} | {lot} पर डेबिट नोट {number} |
| `subject.dcCredit` | Credit note {number} on {lot} | {lot} पर क्रेडिट नोट {number} |
| `subject.dieRerank` | Copy {code}, tier {from} to {to} | कॉपी {code}, टियर {from} से {to} |
| `subject.dieRerankNew` | Copy {code}, set tier {to} | कॉपी {code}, टियर {to} करें |
| `subject.reallocate` | {count} {count:bundle\|bundles}, {kg} kg: {from} to {to} | {count} bundle, {kg} kg: {from} से {to} को |
| `subject.generic` | {ref} | {ref} |
| `subject.castClose` | Close cast {number}, tail {kg} kg | कास्ट {number} बंद करें, टेल {kg} kg |
| `subject.castCloseBare` | Close cast {number} | कास्ट {number} बंद करें |
| `subject.meltCorrect` | Correct melt {seq} of cast {number} | कास्ट {number} की मेल्ट {seq} सुधारें |
| `foundry.title` | Figures | आँकड़े |
| `foundry.produced` | Billets made | बने बिलेट |
| `foundry.metalIn` | Metal in | डाला मेटल |
| `foundry.logs` | Logs out | निकले लॉग |
| `foundry.tail` | Tail | टेल |
| `foundry.short` | Billets short | बिलेट कम |
| `foundry.ledgerOnHand` | On hand by the ledger | खाते के हिसाब से हाथ में |
| `foundry.counted` | Counted by the closer | बंद करने वाले ने गिने |
| `foundry.adjust` | Ledger moves by | खाता इतना हिलेगा |
| `openCast` | Open cast | कास्ट खोलें |
| `openMelt` | Open melt | मेल्ट खोलें |
| `move.title` | What moves | क्या जा रहा है |
| `move.bundles` | Bundles | Bundle |
| `move.count` | {count} {count:bundle\|bundles}, {kg} kg | {count} bundle, {kg} kg |
| `move.from` | From | कहां से |
| `move.to` | To | कहां को |
| `move.reason` | Reason | कारण |
| `move.plant` | plant stock | प्लांट स्टॉक |
| `move.line` | {party}, {order} line {line} | {party}, {order} लाइन {line} |
| `openOrder` | Open order | ऑर्डर खोलें |
| `askedBy` | Asked by {name} | {name} ने मांगा |
| `someone` | Someone | किसी ने |
| `decidedBy` | {status} by {name} | {name} ने {status} किया |
| `review` | Review | देखें और तय करें |
| `view` | View | देखें |
| `approve` | Approve | मंज़ूर करें |
| `reject` | Reject | नामंज़ूर करें |
| `approved` | Approved | मंज़ूर किया |
| `rejected` | Rejected | नामंज़ूर किया |
| `note` | Note | नोट |
| `noteHint` | Say why when you reject, so it can be fixed. | नामंज़ूर करें तो वजह लिखें, ताकि ठीक हो सके। |
| `rejectNeedsNote` | Write why you are rejecting it. | नामंज़ूर करने की वजह लिखें। |
| `own` | Someone else has to approve your request. | आपकी रिक्वेस्ट कोई और मंज़ूर करेगा। |
| `viewOnly` | A manager approves this. | इसे मैनेजर मंज़ूर करते हैं। |
| `openLot` | Open lot | लॉट खोलें |
| `openDie` | Open die | डाई खोलें |
| `theirNote` | Their note | उनका नोट |
| `decisionNote` | Decision note | फ़ैसले का नोट |
| `figures` | Figures | आंकड़े |
| `party` | Party kanta | पार्टी का कांटा |
| `ours` | Our kanta | हमारा कांटा |
| `short` | Short | कमी |
| `tolerance` | Tolerance | छूट |
| `kgDiff` | Kg in this note | इस नोट के kg |
| `bori` | Bori deduction | बोरी कटौती |
| `amount` | Amount | रकम |
| `rate` | Rate | रेट |
| `covers` | Covers the short beyond {pct} | {pct} से ज़्यादा वाली कमी ढकता है |
| `notCovers` | Does not cover the short beyond {pct} | {pct} से ज़्यादा वाली कमी नहीं ढकता |
| `overShort` | This note is {kg} kg more than the short. Check it before approving. | यह नोट कमी से {kg} kg ज़्यादा है। मंज़ूर करने से पहले जांचें। |
| `overShortWithOthers` | With the lot's other weight notes, this comes to {kg} kg more than the short. Check it before approving. | लॉट के बाकी वज़न वाले नोट मिलाकर यह कमी से {kg} kg ज़्यादा है। मंज़ूर करने से पहले जांचें। |
| `moreError` | More requests didn't load. Press Show more to try again. | और रिक्वेस्ट लोड नहीं हुईं। फिर से कोशिश के लिए और दिखाएं दबाएं। |
| `otherNotes` | Other notes on this lot | इस लॉट के बाकी नोट |
| `figuresHidden` | Your role can't see the purchase figures. | आपके रोल को खरीद के आंकड़े नहीं दिखते। |
| `emptyPendingTitle` | Nothing waiting | कुछ इंतज़ार में नहीं |
| `emptyPendingBody` | Requests for a second person show up here. | जिन पर दूसरे की मंज़ूरी चाहिए, वे यहां दिखेंगे। |
| `emptyTitle` | No requests here | यहां कोई रिक्वेस्ट नहीं |
| `emptyBody` | Nothing matches this filter. | इस फ़िल्टर में कुछ नहीं मिला। |
| `error` | The requests didn't load. Check the connection and try again. | रिक्वेस्ट लोड नहीं हुईं। कनेक्शन देखें और फिर से कोशिश करें। |

### dieRoom (433)

| Key | English | हिंदी |
|---|---|---|
| `title` | Die room | Die रूम |
| `print.button` | Print card | कार्ड प्रिंट करें |
| `print.date` | Date | तारीख |
| `print.readings` | Last readings | पिछली रीडिंग |
| `copies.title` | Copies | कॉपी |
| `copies.copy` | Copy | कॉपी |
| `copies.tier` | Tier {rank} | टियर {rank} |
| `copies.untiered` | No tier | कोई टियर नहीं |
| `copies.latestWeight` | Latest kg/12ft | ताज़ा kg/12ft |
| `copies.drift` | Drift | बढ़त |
| `copies.band` | Band | बैंड |
| `copies.primaryBand` | Main band | मुख्य बैंड |
| `copies.owner` | Owner | मालिक |
| `copies.rack` | Rack | रैक |
| `copies.empty` | No copies of this die yet. | इस die की अभी कोई कॉपी नहीं। |
| `copies.add` | Add copy | कॉपी जोड़ें |
| `copies.suggestFirst` | Use first | पहले इसे चलाएं |
| `status.available` | In rack | रैक में |
| `status.in_use` | On press | प्रेस पर |
| `status.at_nitriding` | At nitriding | नाइट्राइडिंग पर |
| `status.at_maker` | At die maker | Die मेकर के पास |
| `status.retired` | Retired | बंद |
| `status.on_trial` | On trial | ट्रायल पर |
| `bands.title` | Bands | बैंड |
| `bands.add` | Add band | बैंड जोड़ें |
| `bands.wall` | Wall (mm) | दीवार (mm) |
| `bands.range` | {min} to {max} kg/12ft | {min} से {max} kg/12ft |
| `bands.label` | Label | नाम |
| `bands.retire` | Retire band | बैंड बंद करें |
| `bands.retireTitle` | Retire this band? | यह बैंड बंद करें? |
| `bands.retireBody` | No copy can be put on it again. Its history stays. | इस पर दोबारा कोई कॉपी नहीं रखी जा सकेगी। इतिहास रहेगा। |
| `bands.retiredToast` | Band retired | बैंड बंद हुआ |
| `bands.duplicate` | This band already exists for this die. | इस die का यह बैंड पहले से है। |
| `bands.primary` | Main band | मुख्य बैंड |
| `bands.retired` | Retired | बंद |
| `bands.noCopies` | No copies on this band. | इस बैंड पर कोई कॉपी नहीं। |
| `bands.liftedTo` | {code} lifted to {band} on {date} | {code} को {date} को {band} में ले गए |
| `card.makerDieNo` | Maker die no. | मेकर का die नंबर |
| `card.makerProjectNo` | Maker project no. | मेकर का प्रोजेक्ट नंबर |
| `card.title` | Die card | Die कार्ड |
| `card.alloy` | Alloy | अलॉय |
| `card.temper` | Temper | टेम्पर |
| `card.profileKind` | Shape | आकार |
| `card.hollow` | Hollow | हॉलो |
| `card.solid` | Solid | सॉलिड |
| `card.semi` | Semi hollow | सेमी हॉलो |
| `card.cavities` | Cavities | कैविटी |
| `card.bolster` | Bolster | बोल्स्टर |
| `card.backer` | Backer | बैकर |
| `card.subBolster` | Sub bolster | सब बोल्स्टर |
| `card.received` | Received | मिली |
| `card.drawing` | Press drawing | प्रेस ड्रॉइंग |
| `card.files` | Files | फ़ाइलें |
| `card.addFile` | Add file | फ़ाइल जोड़ें |
| `card.notFound` | This copy doesn't exist. | यह कॉपी नहीं मिली। |
| `card.loadFailed` | This card didn't load. Check the connection and try again. | यह कार्ड नहीं खुला। कनेक्शन देखकर फिर कोशिश करें। |
| `card.noReading` | No reading yet | अभी कोई रीडिंग नहीं |
| `card.cardTitle` | Card | कार्ड |
| `card.ownerLabel` | Owner: | मालिक: |
| `card.wall` | Wall | दीवार |
| `card.trial` | Trial weight | ट्रायल वज़न |
| `card.hardness` | Hardness (HV) | कठोरता (HV) |
| `card.supplier` | Supplier | सप्लायर |
| `card.ftr` | FTR | FTR |
| `card.lifeLine` | Life {produced} of {life} kg | लाइफ {produced} / {life} kg |
| `card.lifeReached` | Life reached | लाइफ पूरी |
| `card.onPress` | On a press. | प्रेस पर है। |
| `card.edit` | Edit card | कार्ड बदलें |
| `card.editTitle` | Edit card {code} | कार्ड {code} बदलें |
| `card.saved` | Card saved | कार्ड सेव हुआ |
| `card.fieldsInvalid` | Check the numbers: whole numbers from 1. | संख्याएं देखें: 1 से शुरू पूरी संख्या। |
| `card.lifeKg` | Life | लाइफ |
| `card.lifeHint` | Whole kg this copy should make. Reaching it warns; it never blocks. | इस कॉपी से कितने kg बनने चाहिए। पूरी होने पर चेतावनी आती है, रुकावट नहीं। |
| `card.retire` | Retire copy | कॉपी बंद करें |
| `card.retireTitle` | Retire {code}? | {code} बंद करें? |
| `card.retireBody` | A retired copy takes no readings and keeps its number. | बंद कॉपी में रीडिंग नहीं चढ़ती, उसका नंबर वही रहता है। |
| `card.retired` | Copy retired | कॉपी बंद हुई |
| `tier.propose` | Change tier | टियर बदलें |
| `tier.lift` | Move to band | बैंड में ले जाएं |
| `tier.pending` | Waiting for approval | मंज़ूरी का इंतज़ार |
| `tier.nothingChanges` | Pick a different tier or band. | दूसरा टियर या बैंड चुनें। |
| `tier.pendingExists` | A change for this copy is already waiting. | इस कॉपी का एक बदलाव पहले से इंतज़ार में है। |
| `tier.waitingManager` | Waiting for a manager | मैनेजर का इंतज़ार |
| `tier.pendingLift` | Move to band {band} | बैंड {band} में ले जाना |
| `tier.pendingRank` | Change to tier {rank} | टियर {rank} करना |
| `tier.openApprovals` | Open approvals | मंज़ूरी खोलें |
| `tier.noPending` | No change is waiting. A manager approves every tier change. | कोई बदलाव इंतज़ार में नहीं। हर टियर बदलाव मैनेजर मंज़ूर करता है। |
| `tier.history` | History | पुराना रिकॉर्ड |
| `tier.liftedTo` | Lifted to {band} | {band} में गई |
| `tier.firstTier` | First tier {rank} | पहला टियर {rank} |
| `tier.rankChange` | Tier {from} to {to} | टियर {from} से {to} |
| `tier.status.pending` | Waiting | इंतज़ार में |
| `tier.status.applied` | Done | हो गया |
| `tier.status.rejected` | Rejected | नामंज़ूर |
| `tier.proposeTitle` | Change tier of {code} | {code} का टियर बदलें |
| `tier.proposeBody` | A manager decides. The copy keeps its tier until then. | मैनेजर तय करता है। तब तक कॉपी का टियर वही रहता है। |
| `tier.rankLabel` | New tier | नया टियर |
| `tier.rankInvalid` | Tier is a whole number from 1. | टियर 1 से शुरू पूरी संख्या है। |
| `tier.reasonRequired` | Write a reason. | कारण लिखें। |
| `tier.sent` | Sent. Waiting for a manager. | भेज दिया। मैनेजर का इंतज़ार। |
| `drift.under` | Under band | बैंड से कम |
| `drift.green` | In band | बैंड में |
| `drift.amber` | Near the edge | किनारे के पास |
| `drift.red` | Over band | बैंड से ज़्यादा |
| `drift.value` | {pct}% over band start | बैंड शुरू से {pct}% ज़्यादा |
| `drift.none` | No reading | कोई रीडिंग नहीं |
| `issue.returnedTrial` | Back on trial | ट्रायल पर लौटी |
| `issue.title` | Issue to press | प्रेस को दें |
| `issue.issue` | Issue | दें |
| `issue.return` | Take back | वापस लें |
| `issue.cancel` | Cancel issue | देना रद्द करें |
| `issue.line` | Press line | प्रेस लाइन |
| `issue.issued` | Issued to {line} | {line} को दी |
| `issue.returned` | Back in rack | रैक में वापस |
| `issue.notAvailable` | This copy is not in the rack. | यह कॉपी रैक में नहीं है। |
| `issue.openIssue` | This copy is already issued. | यह कॉपी पहले से दी हुई है। |
| `issue.dieOnPress` | The die is still on the press. Log the run first. | Die अभी प्रेस पर है। पहले रन दर्ज करें। |
| `maker.receivedTrialToast` | {number}: {code} is back, on trial | {number}: {code} लौट आई, ट्रायल पर |
| `maker.comesBackOnTrial` | The copy comes back on trial. A trial run or a manager makes it available. | कॉपी ट्रायल पर लौटती है। ट्रायल रन या मैनेजर उसे उपलब्ध करता है। |
| `maker.title` | Die maker | Die मेकर |
| `maker.makers` | Die makers | Die मेकर |
| `maker.addMaker` | Add die maker | Die मेकर जोड़ें |
| `maker.send` | Send to maker | मेकर को भेजें |
| `maker.receive` | Received back | वापस मिली |
| `maker.purpose` | Why | क्यों |
| `maker.trial` | Trial | ट्रायल |
| `maker.correction` | Correction | सुधार |
| `maker.repair` | Repair | मरम्मत |
| `maker.job` | Job {number} | जॉब {number} |
| `maker.none` | Not with a die maker | Die मेकर के पास नहीं है |
| `maker.noneBody` | Send it for a trial, a correction or a repair. | ट्रायल, सुधार या मरम्मत के लिए भेजें। |
| `maker.notOnRack` | It is {status}. Only a copy in the rack can be sent. | यह {status} है। सिर्फ़ रैक की कॉपी भेजी जा सकती है। |
| `maker.makerName` | Die maker | Die मेकर |
| `maker.sent` | Sent | भेजी |
| `maker.statusLabel` | Status | स्थिति |
| `maker.statusSent` | Out with the maker | मेकर के पास |
| `maker.cancel` | Cancel send | भेजना रद्द करें |
| `maker.cancelled` | Send cancelled | भेजना रद्द हुआ |
| `maker.cancelTitle` | Cancel the send {number}? | भेजना {number} रद्द करें? |
| `maker.cancelBody` | {code} comes back to the rack. Nothing is kept as sent. | {code} रैक में लौट आती है। भेजा हुआ कुछ दर्ज नहीं रहता। |
| `maker.keepJob` | Keep the send | भेजना रहने दें |
| `maker.history` | Earlier jobs | पुराने जॉब |
| `maker.status.sent` | Sent | भेजी |
| `maker.status.received` | Received | मिल गई |
| `maker.status.cancelled` | Cancelled | रद्द |
| `maker.sendTitle` | Send {code} to a die maker | {code} को die मेकर को भेजें |
| `maker.pickMaker` | Pick a die maker | Die मेकर चुनें |
| `maker.noMakers` | There is no die maker yet. | अभी कोई die मेकर नहीं है। |
| `maker.addMakerLink` | Add one | एक जोड़ें |
| `maker.sentToast` | {number}: {code} sent | {number}: {code} भेजी |
| `maker.receiveTitle` | Receive {number} | {number} वापस लें |
| `maker.trialSet` | Trial weight is already {kg} kg/12ft. It stays. | ट्रायल वज़न पहले से {kg} kg/12ft है। वही रहेगा। |
| `maker.trialHint` | kg per 12 ft. This is not a drift reading. | kg/12ft। यह बढ़त की रीडिंग नहीं है। |
| `maker.receivedToast` | {number}: {code} is back in the rack | {number}: {code} रैक में वापस |
| `owner.title` | Owner | मालिक |
| `owner.belongsTo` | This die belongs to {name} | यह die {name} की है |
| `owner.pickCopy` | Pick the die copy | Die की कॉपी चुनें |
| `owner.noCopies` | This section has no copies | इस सेक्शन की कोई कॉपी नहीं है |
| `owner.requestOverride` | Ask to use it for {name} | {name} के लिए चलाने की मंज़ूरी मांगें |
| `owner.purpose.plan` | Plan | प्लान |
| `owner.purpose.press` | Press | प्रेस |
| `owner.purpose.pack` | Pack | पैकिंग |
| `owner.purpose.dispatch` | Dispatch | Dispatch |
| `owner.checkTitle` | Who may use this die | यह die कौन चला सकता है |
| `owner.purposeLabel` | Check for | किसके लिए जांचें |
| `owner.checkBody` | Check a copy for a customer before you plan, press, pack or dispatch it. | प्लान, प्रेस, पैक या dispatch से पहले कॉपी को ग्राहक के लिए जांचें। |
| `owner.forParty` | For customer | ग्राहक |
| `owner.plantStock` | Plant stock (no customer) | प्लांट स्टॉक (कोई ग्राहक नहीं) |
| `owner.pickToCheck` | Pick a copy to check. | जांचने के लिए कॉपी चुनें। |
| `owner.allowedPlant` | Allowed. This die belongs to the plant. | चल सकती है। यह die प्लांट की है। |
| `owner.allowedOwner` | Allowed. This die belongs to {name}. | चल सकती है। यह die {name} की है। |
| `owner.allowedByException` | Allowed for {name} by an approved exception. | {name} के लिए मंज़ूर अपवाद से चल सकती है। |
| `owner.waitingManager` | Waiting for a manager. The exception is for {name} only. | मैनेजर का इंतज़ार। अपवाद सिर्फ़ {name} के लिए है। |
| `owner.whyLabel` | Why is it needed | क्यों चाहिए |
| `owner.whyRequired` | Say why. | कारण लिखें। |
| `owner.requested` | Asked. Waiting for a manager. | मांग भेजी। मैनेजर का इंतज़ार। |
| `owner.partySearch` | Search customers | ग्राहक खोजें |
| `owner.exceptionsTitle` | Exceptions on {code} | {code} पर अपवाद |
| `owner.exceptionsNone` | No open exception on this copy. | इस कॉपी पर कोई खुला अपवाद नहीं। |
| `owner.exceptionsFailed` | The exceptions didn't load. | अपवाद नहीं खुले। |
| `owner.approvedOn` | Approved {date} | {date} को मंज़ूर |
| `owner.closeException` | Close exception | अपवाद बंद करें |
| `owner.closeTitle` | Close the exception on {code}? | {code} का अपवाद बंद करें? |
| `owner.closeBody` | {name} can no longer use {code}. The next check says who owns it. | {name} अब {code} नहीं चला सकता। अगली जांच बताएगी कि यह किसकी है। |
| `owner.closedToast` | Exception closed | अपवाद बंद हुआ |
| `position.in` | In band | बैंड में |
| `position.above` | Above band | बैंड से ऊपर |
| `position.below` | Below band | बैंड से नीचे |
| `tabs.readings` | Readings | रीडिंग |
| `tabs.runs` | Runs | रन |
| `tabs.nitriding` | Nitriding | नाइट्राइडिंग |
| `tabs.work` | Work | काम |
| `tabs.tier` | Tier | टियर |
| `tabs.maker` | Maker | मेकर |
| `tabs.files` | Files | फ़ाइलें |
| `work.add` | Log work | काम दर्ज करें |
| `work.title` | Log work on {code} | {code} पर काम दर्ज करें |
| `work.body` | Polishing, correction, inspection or cleaning done in the die room. Nothing moves in stock. | Die room में किया गया पॉलिश, करेक्शन, जाँच या सफ़ाई। स्टॉक में कुछ नहीं बदलता। |
| `work.kind` | What was done | क्या किया |
| `work.day` | Day | दिन |
| `work.hv` | Hardness after (HV) | बाद की हार्डनेस (HV) |
| `work.note` | Note | नोट |
| `work.noteRequired` | Say what was done in the note. | नोट में लिखें कि क्या किया। |
| `work.backOnTrial` | Send the copy back on trial | Copy को फिर ट्रायल पर भेजें |
| `work.backOnTrialHint` | After a correction the copy runs a die trial before production. | करेक्शन के बाद copy प्रोडक्शन से पहले die ट्रायल चलाती है। |
| `work.save` | Save work | काम सेव करें |
| `work.saved` | Work logged on {code} | {code} पर काम दर्ज हुआ |
| `work.sentOnTrial` | Sent on trial | ट्रायल पर भेजी |
| `work.hardness` | {hv} HV | {hv} HV |
| `work.by` | by {name} | {name} ने |
| `work.empty` | No work logged yet | अभी कोई काम दर्ज नहीं |
| `work.emptyBody` | Polishing, corrections, inspections and cleaning show here, newest first. | पॉलिश, करेक्शन, जाँच और सफ़ाई यहाँ दिखते हैं, नए पहले। |
| `work.offRack` | Work is logged on the rack. Return the copy first. | काम रैक पर दर्ज होता है। पहले copy वापस लाएँ। |
| `work.hvInvalid` | Enter hardness as a whole number, for example 950. | हार्डनेस पूरी संख्या में डालें, जैसे 950। |
| `work.dayInvalid` | Pick a day that is not in the future. | ऐसा दिन चुनें जो आगे का न हो। |
| `trial.title` | On trial | ट्रायल पर |
| `trial.body` | This copy goes only to a die trial run. It becomes available when a trial passes. | यह कॉपी सिर्फ़ die ट्रायल रन पर जाती है। ट्रायल पास होने पर यह उपलब्ध हो जाती है। |
| `trial.issueToTrial` | Issue to a trial run | ट्रायल रन को दें |
| `trial.release` | Release without a trial | ट्रायल के बिना छोड़ें |
| `trial.releaseTitle` | Release {code} without a trial? | {code} को ट्रायल के बिना छोड़ें? |
| `trial.releaseBody` | The copy becomes available for production. Your reason is kept in the audit trail. | कॉपी प्रोडक्शन के लिए उपलब्ध हो जाएगी। आपकी वजह ऑडिट रिकॉर्ड में रहेगी। |
| `trial.reasonRequired` | Write why. A few words are enough. | वजह लिखें। कुछ शब्द काफ़ी हैं। |
| `trial.releaseConfirm` | Release | छोड़ें |
| `trial.releasedToast` | {code} is available | {code} उपलब्ध है |
| `bulk.menu` | Attach drawings by file name | फ़ाइल के नाम से ड्रॉइंग जोड़ें |
| `bulk.title` | Attach drawings | ड्रॉइंग जोड़ें |
| `bulk.intro` | Pick many files at once. The file name says where each one goes. | एक साथ कई फ़ाइलें चुनें। फ़ाइल का नाम बताता है कि वह कहां जाएगी। |
| `bulk.pick` | Files | फ़ाइलें |
| `bulk.ruleSection` | 12170.pdf goes to die 12170. | 12170.pdf, die 12170 में जाती है। |
| `bulk.ruleCopy` | 12170-1.cdr goes to copy 12170-1. | 12170-1.cdr, कॉपी 12170-1 में जाती है। |
| `bulk.ruleDrawing` | A PDF becomes the press drawing only if the die has none. | PDF तभी प्रेस ड्रॉइंग बनती है जब die की कोई ड्रॉइंग न हो। |
| `bulk.reading` | Reading the file names | फ़ाइलों के नाम पढ़ रहे हैं |
| `bulk.attach` | Attach {count} files | {count} फ़ाइलें जोड़ें |
| `bulk.retry` | Try {count} again | {count} फिर से भेजें |
| `bulk.progress` | {done} of {total} files | {total} में से {done} फ़ाइलें |
| `bulk.summary` | {saved} saved, {failed} failed, {already} already there, {notMatched} not matched. | {saved} सेव हुईं, {failed} नहीं गईं, {already} पहले से थीं, {notMatched} का मिलान नहीं हुआ। |
| `bulk.willAttach` | To attach ({count}) | जोड़ी जाएंगी ({count}) |
| `bulk.toSection` | Die {target} | Die {target} |
| `bulk.toCopy` | Copy {target} | कॉपी {target} |
| `bulk.asDrawing` | Press drawing | प्रेस ड्रॉइंग |
| `bulk.nothingToAttach` | No file can be attached. Check the file names. | कोई फ़ाइल नहीं जोड़ी जा सकती। फ़ाइलों के नाम देखें। |
| `bulk.alreadyTitle` | Already there ({count}) | पहले से हैं ({count}) |
| `bulk.notMatchedTitle` | Not attached ({count}) | नहीं जोड़ी गईं ({count}) |
| `bulk.reason.unmatched` | No die or copy has this code. | इस कोड का कोई die या कॉपी नहीं है। |
| `bulk.reason.unsupported` | orrn keeps images, PDF, CDR and DWG files only. | orrn सिर्फ़ फ़ोटो, PDF, CDR और DWG फ़ाइलें रखता है। |
| `bulk.reason.ambiguous` | Two dies have this section code. Attach it from the die. | दो die का सेक्शन कोड यही है। उसे die के पन्ने से जोड़ें। |
| `bulk.state.saved` | Saved | सेव हुई |
| `bulk.state.uploading` | Sending | भेज रहे हैं |
| `bulk.state.error` | Failed | नहीं गई |
| `bulk.putFailed` | The file did not go through. Check the connection and try again. | फ़ाइल नहीं पहुंची। कनेक्शन देखें और फिर से कोशिश करें। |
| `bulk.savedToast` | {count} files attached | {count} फ़ाइलें जुड़ीं |
| `errors.exists` | Already exists: {code} | पहले से है: {code} |
| `board.tilesLabel` | Copies by state | स्थिति के हिसाब से कॉपी |
| `board.filtersLabel` | Filters | फ़िल्टर |
| `board.filter.all` | All | सभी |
| `board.filter.customerOwned` | Owned by a customer | ग्राहक के मालिकाना |
| `board.sortLabel` | Sort by | इस क्रम में |
| `board.sort.newest` | Newest first | नया पहले |
| `board.sort.code` | Series and section | सीरीज़ और सेक्शन |
| `board.sort.band` | Lightest band first | हल्का बैंड पहले |
| `board.sort.copies` | Most copies first | ज़्यादा कॉपी पहले |
| `board.clearFilters` | Clear filters | फ़िल्टर हटाएं |
| `board.noFilterMatch` | No die matches | कोई die नहीं मिला |
| `board.noFilterMatchBody` | Clear the filters to see every die. | सभी die देखने के लिए फ़िल्टर हटाएं। |
| `board.tiles.on_trial` | On trial | ट्रायल पर |
| `board.tiles.available` | In rack | रैक में |
| `board.tiles.in_use` | On press | प्रेस पर |
| `board.tiles.at_nitriding` | At nitriding | नाइट्राइडिंग पर |
| `board.tiles.at_maker` | At die maker | Die मेकर के पास |
| `board.tiles.none` | Dies without copies | बिना कॉपी वाले die |
| `board.trialSetting.title` | New copies start on trial | नई कॉपी ट्रायल से शुरू हो |
| `board.trialSetting.body` | A new copy, and a copy back from the die maker, goes only to a die trial run until a trial passes or a manager releases it. | नई कॉपी और die मेकर से लौटी कॉपी तब तक सिर्फ़ die ट्रायल रन पर जाती है, जब तक ट्रायल पास न हो या मैनेजर उसे छोड़ न दे। |
| `board.trialSetting.saved` | Setting saved | सेटिंग सेव हुई |
| `board.searchHint` | Search a section, a series or a copy like 12170-2 | सेक्शन, सीरीज़ या कॉपी खोजें, जैसे 12170-2 |
| `board.slashHint` | A slash works too: 12170/2 finds 12170-2. | स्लैश भी चलता है: 12170/2 से 12170-2 मिलती है। |
| `board.columns.copy` | Copy | कॉपी |
| `board.columns.series` | Series | सीरीज़ |
| `board.columns.shape` | Shape | आकार |
| `board.columns.band` | Weight band | वज़न बैंड |
| `board.columns.owner` | Owner | मालिक |
| `board.columns.copies` | Copies | कॉपी |
| `board.columns.drift` | Drift | बढ़त |
| `board.plantOwned` | Plant-owned | प्लांट की अपनी |
| `board.noCopies` | No copies | कोई कॉपी नहीं |
| `board.issueLink` | Issue and return | प्रेस को दें और वापस लें |
| `board.makersLink` | Die makers | Die मेकर |
| `board.loadFailed` | The dies didn't load. Check the connection and try again. | Die की सूची नहीं खुली। कनेक्शन देखकर फिर कोशिश करें। |
| `board.noMatchBody` | Try a section code, a series or a copy code. | सेक्शन कोड, सीरीज़ या कॉपी कोड आज़माएं। |
| `board.copiesNote` | These are the copies in this state. Each one opens its card. | ये इस स्थिति वाली कॉपी हैं। हर कॉपी अपना कार्ड खोलती है। |
| `board.copiesLabel` | Copies in this state | इस स्थिति वाली कॉपी |
| `board.noCopiesInState` | No copy is in this state | इस स्थिति में कोई कॉपी नहीं |
| `board.noCopiesInStateBody` | Clear the tile to see every die. | सभी die देखने के लिए टाइल हटाएं। |
| `section.copyAddedTrial` | {code} added, on trial | {code} जुड़ी, ट्रायल पर |
| `section.startsOnTrial` | A new copy starts on trial until a trial passes or a manager releases it. | नई कॉपी ट्रायल से शुरू होती है, जब तक ट्रायल पास न हो या मैनेजर उसे छोड़ न दे। |
| `section.useFirst` | Run {code} first: {kg} kg/12ft, in band. | पहले {code} चलाएं: {kg} kg/12ft, बैंड में। |
| `section.bandsAndCopies` | Bands and copies | बैंड और कॉपी |
| `section.emptyCopiesBody` | The copy number is given when you add one. | कॉपी जोड़ते समय उसका नंबर अपने आप मिलता है। |
| `section.cavityCount` | {count} cavities | {count} कैविटी |
| `section.addCopyTitle` | New copy of {code} | {code} की नई कॉपी |
| `section.addCopyBody` | The copy number comes from the server and is never reused. | कॉपी का नंबर सर्वर देता है और दोबारा नहीं आता। |
| `section.tierOptional` | Tier (optional) | टियर (ज़रूरी नहीं) |
| `section.copyAdded` | {code} added | {code} जुड़ गई |
| `band.title` | New band | नया बैंड |
| `band.backToSection` | Back to this die | इस die पर वापस |
| `band.intro` | A second copy on a band is always allowed. A second band with the same wall and weights is not. | एक बैंड पर दूसरी कॉपी हमेशा चलती है। उसी दीवार और वज़न का दूसरा बैंड नहीं बनता। |
| `band.wallHint` | Millimetres. Blank means {wall}. | मिलीमीटर। खाली छोड़ें तो {wall}। |
| `band.wallNone` | Millimetres. This die has no wall written; type it. | मिलीमीटर। इस die की दीवार लिखी नहीं है, खुद लिखें। |
| `band.min` | Min | कम से कम |
| `band.max` | Max | ज़्यादा से ज़्यादा |
| `band.wallInvalid` | Enter the wall in millimetres, like 1.2. | दीवार मिलीमीटर में लिखें, जैसे 1.2। |
| `band.kgInvalid` | Enter kg per 12 ft with up to three decimals, like 5.967. | kg/12ft तीन दशमलव तक लिखें, जैसे 5.967। |
| `band.useExisting` | Add the copy to that band instead. | कॉपी को उसी बैंड में जोड़ें। |
| `band.save` | Save band | बैंड सेव करें |
| `band.saved` | Band saved | बैंड सेव हुआ |
| `band.cantAdd` | Your role can't add bands. Ask a manager or admin. | आपका रोल बैंड नहीं जोड़ सकता। मैनेजर या एडमिन से कहें। |
| `reading.add` | Add reading | रीडिंग जोड़ें |
| `reading.title` | Reading for {code} | {code} की रीडिंग |
| `reading.noneYet` | kg per 12 ft. No reading yet. | kg/12ft। अभी कोई रीडिंग नहीं। |
| `reading.last` | kg per 12 ft. Last reading {kg}. | kg/12ft। पिछली रीडिंग {kg}। |
| `reading.weight` | Weight of 12 ft | 12 ft का वज़न |
| `reading.bandHint` | Band {band}. | बैंड {band}। |
| `reading.serverFigures` | The percent and colour are worked out when you save. | सेव करने पर प्रतिशत और रंग तय होते हैं। |
| `reading.backspace` | Backspace | मिटाएं |
| `reading.saved` | {code}: {kg} kg/12ft saved | {code}: {kg} kg/12ft सेव हुआ |
| `reading.empty` | No readings yet | अभी कोई रीडिंग नहीं |
| `reading.emptyBody` | Weigh 12 ft off this die and add the weight. | इस die से 12 ft तौलकर वज़न जोड़ें। |
| `reading.trendLabel` | Readings, kg per 12 ft | रीडिंग, kg/12ft |
| `reading.bench` | Bench | बेंच |
| `reading.trialNote` | Trial weight. Not a drift reading. | ट्रायल वज़न। बढ़त की रीडिंग नहीं। |
| `runs.label` | Press runs | प्रेस रन |
| `runs.empty` | No runs yet | अभी कोई रन नहीं |
| `runs.emptyBody` | Press runs appear here once they are logged. | रन दर्ज होने पर यहां दिखेंगे। |
| `runs.loadFailed` | The runs didn't load. | रन नहीं खुले। |
| `runs.run` | Run | रन |
| `runs.day` | Day | दिन |
| `runs.shiftSeq` | shift {seq} | शिफ़्ट {seq} |
| `runs.input` | In (kg) | अंदर (kg) |
| `runs.output` | Out (kg) | बाहर (kg) |
| `runs.recovery` | Recovery | रिकवरी |
| `runs.reading` | Reading | रीडिंग |
| `runs.accumulated` | Total made (kg) | अब तक बना (kg) |
| `runs.remark` | Remark | टिप्पणी |
| `nitriding.send` | Send to nitriding | नाइट्राइडिंग पर भेजें |
| `nitriding.back` | Back from nitriding | नाइट्राइडिंग से वापस |
| `nitriding.empty` | No nitriding yet | अभी कोई नाइट्राइडिंग नहीं |
| `nitriding.emptyBody` | Each treatment is written here with its chemicals. | हर ट्रीटमेंट केमिकल के साथ यहां लिखा जाता है। |
| `nitriding.hardness` | HV {hv} | HV {hv} |
| `nitriding.noHardness` | No HV written | HV नहीं लिखी |
| `nitriding.chem.cr4` | CR4 | CR4 |
| `nitriding.chem.cr2` | CR2 | CR2 |
| `nitriding.chem.k2s` | K2S | K2S |
| `nitriding.chem.caustic` | Caustic | कॉस्टिक |
| `nitriding.balance` | open {open} g, used {used} g, close {close} g | शुरू {open} g, लगा {used} g, बचा {close} g |
| `nitriding.sendTitle` | Send {code} to nitriding | {code} को नाइट्राइडिंग पर भेजें |
| `nitriding.sendBody` | Write what was used. Leave a chemical empty if it was not drawn. | जो लगा वह लिखें। जो नहीं निकला उसे खाली छोड़ें। |
| `nitriding.hvLabel` | HV before | पहले की HV |
| `nitriding.hvAfter` | HV after treatment | ट्रीटमेंट के बाद की HV |
| `nitriding.hvInvalid` | HV is a whole number from 1. | HV 1 से शुरू पूरी संख्या है। |
| `nitriding.open` | Open | शुरू |
| `nitriding.used` | Used | लगा |
| `nitriding.closeLine` | {open} - {used} = {close} g left | {open} - {used} = {close} g बचा |
| `nitriding.chemInvalid` | {name}: write open and used in grams, used not above open. | {name}: शुरू और लगा ग्राम में लिखें, लगा शुरू से ज़्यादा नहीं। |
| `nitriding.sent` | {code} is out at nitriding | {code} नाइट्राइडिंग पर है |
| `nitriding.backTitle` | {code} back from nitriding | {code} नाइट्राइडिंग से वापस |
| `nitriding.returned` | {code} is back in the rack | {code} रैक में वापस है |
| `files.empty` | No files | कोई फ़ाइल नहीं |
| `files.emptyBody` | Add the press drawing, a photo or a CDR or DWG file. | प्रेस ड्रॉइंग, फ़ोटो या CDR/DWG फ़ाइल जोड़ें। |
| `files.wholeSection` | whole die | पूरी die |
| `files.openDrawing` | Open drawing | ड्रॉइंग खोलें |
| `files.asDrawing` | This is the press drawing (PDF) | यह प्रेस ड्रॉइंग है (PDF) |
| `files.limits` | Images up to 8 MB, PDF up to 25 MB, CDR and DWG up to 40 MB. | फ़ोटो 8 MB तक, PDF 25 MB तक, CDR और DWG 40 MB तक। |
| `files.badType` | Pick an image, a PDF, a CDR or a DWG file. | फ़ोटो, PDF, CDR या DWG फ़ाइल चुनें। |
| `files.drawingPdf` | The press drawing must be a PDF. | प्रेस ड्रॉइंग PDF होनी चाहिए। |
| `files.added` | File added | फ़ाइल जुड़ी |
| `files.removed` | File removed | फ़ाइल हटी |
| `files.removeTitle` | Remove {name}? | {name} हटाएं? |
| `files.removeBody` | The file is deleted from the die. | फ़ाइल die से हट जाएगी। |
| `lift.title` | Move to another band | दूसरे बैंड में ले जाएं |
| `lift.backToCard` | Back to the card | कार्ड पर वापस |
| `lift.codeStays` | This code will not change | यह कोड नहीं बदलेगा |
| `lift.currentBand` | Current band | अभी का बैंड |
| `lift.reading` | Reading | रीडिंग |
| `lift.aboveBy` | above by {g} g | {g} g ऊपर |
| `lift.belowBy` | below by {g} g | {g} g नीचे |
| `lift.proposeTitle` | Ask for the move | बदलाव मांगें |
| `lift.oldBandKeeps` | The old band keeps an empty slot for this copy. | पुराने बैंड में इस कॉपी की जगह खाली दिखती है। |
| `lift.targetBand` | Move to band | इस बैंड में |
| `lift.rankAfter` | Tier after the move | बदलाव के बाद टियर |
| `lift.managerDecides` | A manager decides in Approvals. | मैनेजर मंज़ूरी में तय करता है। |
| `lift.noOtherBand` | This die has no other band. Add one first. | इस die का कोई दूसरा बैंड नहीं है। पहले एक जोड़ें। |
| `lift.dieRoomOnly` | Only the die room asks for a move. | बदलाव सिर्फ़ die रूम मांगता है। |
| `lift.submit` | Ask for approval | मंज़ूरी मांगें |
| `issues.noTrialRun` | No die trial run is waiting for this section. A copy on trial goes only to a die trial run: release one in the plan first. | इस सेक्शन के लिए कोई die ट्रायल रन इंतज़ार में नहीं। ट्रायल वाली कॉपी सिर्फ़ die ट्रायल रन पर जाती है: पहले प्लान में एक छोड़ें। |
| `issues.trialNote` | This copy is on trial. It goes only to a die trial run. | यह कॉपी ट्रायल पर है। यह सिर्फ़ die ट्रायल रन पर जाती है। |
| `issues.trialRun` | Die trial | Die ट्रायल |
| `issues.pickRun` | Pick a press run | प्रेस रन चुनें |
| `issues.noRun` | No press run is waiting for a die of this section. Release one in the plan first. | इस सेक्शन के किसी रन को die का इंतज़ार नहीं है। पहले प्लान में रन छोड़ें। |
| `issues.run` | Press run | प्रेस रन |
| `issues.lifeReached` | Life reached. The copy was issued anyway. | लाइफ पूरी हो चुकी है। फिर भी कॉपी दे दी गई। |
| `issues.title` | Issue and return | प्रेस को दें और वापस लें |
| `issues.subtitle` | Hand a copy to a press and take it back. | कॉपी प्रेस को दें और वापस लें। |
| `issues.pickCopy` | Pick a copy | कॉपी चुनें |
| `issues.pickLine` | Pick a press line | प्रेस लाइन चुनें |
| `issues.noneOnRack` | No copy in the rack | रैक में कोई कॉपी नहीं |
| `issues.noneOnRackBody` | Every copy is out, or the die has none yet. | सारी कॉपी बाहर हैं, या अभी किसी die की कॉपी नहीं है। |
| `issues.dieRoomOnly` | Only the die room hands out dies. | Die सिर्फ़ die रूम देता है। |
| `issues.issuedToast` | Copy issued | कॉपी दी गई |
| `issues.open` | On a press now | अभी प्रेस पर |
| `issues.noneOpen` | Nothing is out | कुछ भी बाहर नहीं |
| `issues.noneOpenBody` | Copies you issue show here until they come back. | जो कॉपी आप देते हैं वह लौटने तक यहां दिखती है। |
| `issues.loadFailed` | The list didn't load. | सूची नहीं खुली। |
| `issues.cancelledToast` | Issue cancelled | देना रद्द हुआ |
| `issues.lineFromRun` | The run sets the press line. | प्रेस लाइन रन से तय होती है। |
| `issues.returnBlocked` | {run} has the die in the press. Take it back after the die is out. | {run} में die प्रेस में लगा है। die निकलने के बाद वापस लें। |
| `issues.cancelBlocked` | {run} has started. Take the die back when it is out. | {run} शुरू हो चुका है। die निकलने पर वापस लें। |
| `issues.cancelTitle` | Cancel the issue of {code}? | {code} का देना रद्द करें? |
| `issues.cancelBody` | {code} goes back to the rack and the press run waits for a copy again. | {code} रैक में लौट जाती है और प्रेस रन फिर कॉपी का इंतज़ार करता है। |
| `issues.keepIssued` | Keep it issued | दिया हुआ रहने दें |
| `makers.subtitle` | Who makes and corrects the dies, and what is with them now. | die कौन बनाता और सुधारता है, और अभी उनके पास क्या है। |
| `makers.empty` | No die maker yet | अभी कोई die मेकर नहीं |
| `makers.emptyBody` | Add the workshops you send dies to. | जिन वर्कशॉप में die भेजते हैं उन्हें जोड़ें। |
| `makers.archive` | Archive | आर्काइव |
| `makers.archived` | Die maker archived | Die मेकर आर्काइव हुआ |
| `makers.archiveTitle` | Archive {name}? | {name} को आर्काइव करें? |
| `makers.archiveBody` | The maker leaves the list for new sends. Past sends keep the name. | मेकर नए भेजने की सूची से हट जाता है। पुराने भेजने में नाम रहता है। |
| `makers.withMakers` | With a die maker now | अभी मेकर के पास |
| `makers.noJobs` | Nothing is out | कुछ भी बाहर नहीं |
| `makers.noJobsBody` | A copy you send shows here until it is received. | भेजी हुई कॉपी वापस आने तक यहां दिखती है। |
| `makers.name` | Name | नाम |
| `makers.city` | City | शहर |
| `makers.phone` | Phone | फ़ोन |
| `makers.nameRequired` | Write the name. | नाम लिखें। |
| `makers.added` | Die maker added | Die मेकर जुड़ गया |

### orders (397)

| Key | English | हिंदी |
|---|---|---|
| `book.bar.column` | Where it stands | कहां तक पहुंचा |
| `book.bar.label` | {number}: kg by stage | {number}: स्टेज के हिसाब से kg |
| `book.bar.dispatchedPct` | {pct}% dispatched | {pct}% dispatch हुआ |
| `book.bar.baki` | Baki {kg} kg | बाकी {kg} kg |
| `book.bar.nothingPlanned` | Nothing planned yet | अभी कुछ प्लान नहीं |
| `book.bar.over` | {kg} kg over the order | ऑर्डर से {kg} kg ज़्यादा |
| `book.due` | Due {date} | देय {date} |
| `book.strip.label` | Order book totals | ऑर्डर बुक का कुल |
| `book.strip.orders` | Open orders | खुले ऑर्डर |
| `book.strip.ofShown` | {count} in this view | इस सूची में {count} |
| `book.strip.ordered` | Ordered | ऑर्डर |
| `book.strip.inStock` | In stock | स्टॉक में |
| `book.strip.held` | Held | होल्ड |
| `book.strip.dispatched` | Dispatched | Dispatch हुआ |
| `book.strip.baki` | Baki | बाकी |
| `book.strip.late` | Late: {count} | लेट: {count} |
| `book.filter.label` | Order book filters | ऑर्डर बुक के फ़िल्टर |
| `book.filter.status` | Status | स्थिति |
| `book.filter.anyOpen` | Any open status | कोई भी खुली स्थिति |
| `book.filter.party` | Party | पार्टी |
| `book.filter.anyParty` | Any party | कोई भी पार्टी |
| `book.filter.city` | City | शहर |
| `book.filter.anyCity` | Any city | कोई भी शहर |
| `book.filter.from` | Ordered from | ऑर्डर की तारीख से |
| `book.filter.to` | Ordered to | ऑर्डर की तारीख तक |
| `book.filter.stage` | Stage | स्टेज |
| `book.filter.anyStage` | Any stage | कोई भी स्टेज |
| `book.filter.clear` | Clear filters | फ़िल्टर हटाएं |
| `book.show.open` | Open | खुले |
| `book.show.booking` | Booking | बुकिंग |
| `book.show.confirmed` | Confirmed | पक्का |
| `book.show.dispatching` | Dispatching | Dispatch चालू |
| `book.show.late` | Late | लेट |
| `book.show.closed` | Closed | बंद |
| `book.show.cancelled` | Cancelled | रद्द |
| `book.stage.dispatched` | Dispatched | Dispatch हुआ |
| `book.stage.in_stock` | In stock | स्टॉक में |
| `book.stage.held` | Held (on a truck or for the order) | होल्ड (ट्रक पर या ऑर्डर के लिए) |
| `book.stage.pressed` | Pressed, not packed | प्रेस हुआ, पैक नहीं |
| `book.stage.planned` | Planned, not pressed | प्लान हुआ, प्रेस नहीं |
| `book.stage.unplanned` | Not planned | प्लान नहीं हुआ |
| `book.stage.over` | Over the order | ऑर्डर से ज़्यादा |
| `lateRule.expected_date` | Its expected date has passed | कब तक चाहिए की तारीख निकल गई |
| `lateRule.order_date` | Ordered more than 15 days ago | ऑर्डर को 15 दिन से ज़्यादा हो गए |
| `stockOn.button` | Stock on this order | इस ऑर्डर का स्टॉक |
| `stockOn.title` | Stock on {number} | {number} का स्टॉक |
| `stockOn.hint` | Bundles in the yard that are packed against this order's lines. | यार्ड के वे bundle जो इस ऑर्डर की लाइनों के लिए पैक हैं। |
| `stockOn.empty` | No stock is held on this order. | इस ऑर्डर का कोई स्टॉक नहीं है। |
| `stockOn.cut` | The list is cut. Open the order for the rest. | सूची कटी हुई है। बाकी के लिए ऑर्डर खोलें। |
| `stockOn.print` | Print | प्रिंट |
| `stockOn.pdf` | PDF | PDF |
| `stockOn.excel` | Excel | Excel |
| `stockOn.failed` | Could not make the file. Try again. | फ़ाइल नहीं बन पाई। फिर कोशिश करें। |
| `phonePlan.none` | No released plan | कोई रिलीज़ प्लान नहीं |
| `phonePlan.noneBody` | A plan shows here once it is released to the press. | प्रेस को रिलीज़ होने के बाद प्लान यहाँ दिखेगा। |
| `phonePlan.planTotal` | {pressed} of {planned} kg pressed ({pct}%) | {planned} में से {pressed} kg प्रेस हुआ ({pct}%) |
| `phonePlan.kgLine` | {pressed} of {planned} kg | {planned} में से {pressed} kg |
| `phonePlan.pcsLine` | {pressed} of {planned} pcs | {planned} में से {pressed} pcs |
| `phonePlan.notStarted` | Not started | शुरू नहीं हुआ |
| `phonePlan.urgent` | Urgent | अर्जेंट |
| `phonePlan.readOnly` | Read only. Make and change plans on a tablet or computer. | सिर्फ़ देखने के लिए। प्लान टैबलेट या कंप्यूटर पर बनाएँ और बदलें। |
| `printOut.order` | Print order | ऑर्डर प्रिंट करें |
| `printOut.orderExcel` | Order in Excel | ऑर्डर Excel में |
| `printOut.plan` | Print shift list | शिफ्ट लिस्ट प्रिंट करें |
| `printOut.planExcel` | Shift list in Excel | शिफ्ट लिस्ट Excel में |
| `printOut.book` | Export to Excel | Excel में निकालें |
| `printOut.bookBusy` | Exporting | निकाल रहे हैं |
| `printOut.bookCut` | Only the first {count} orders went into the file. | फ़ाइल में सिर्फ़ पहले {count} ऑर्डर गए। |
| `printOut.failed` | Could not make the file. Try again. | फ़ाइल नहीं बन पाई। फिर कोशिश करें। |
| `title` | Orders | ऑर्डर |
| `new` | New order | नया ऑर्डर |
| `number` | Order | ऑर्डर |
| `poNumber` | PO number | PO नंबर |
| `orderDate` | Order date | ऑर्डर की तारीख |
| `expectedDate` | Expected by | कब तक चाहिए |
| `source.office` | Office | ऑफ़िस |
| `source.portal` | Portal | पोर्टल |
| `source.label` | Booked from | कहां से बुक हुआ |
| `status.booking` | Booking | बुकिंग |
| `status.confirmed` | Confirmed | पक्का |
| `status.dispatching` | Dispatching | Dispatch चालू |
| `status.closed` | Closed | बंद |
| `status.cancelled` | Cancelled | रद्द |
| `line.copy` | Die copy | Die कॉपी |
| `line.tierOrBetter` | Tier {rank} or better | टियर {rank} या बेहतर |
| `line.cutLength` | Cut length | कट लंबाई |
| `line.pcs` | Pieces | पीस |
| `line.kg` | kg | kg |
| `line.basis` | kg/12ft | kg/12ft |
| `line.finish` | Finish | फ़िनिश |
| `line.alloy` | Alloy | अलॉय |
| `line.temper` | Temper | टेम्पर |
| `line.rate` | Rate (Rs/kg) | रेट (Rs/kg) |
| `line.die` | Die | Die |
| `line.anyCopy` | The die room picks the copy | कॉपी die room चुनेगा |
| `line.copyCode` | Copy {code} | कॉपी {code} |
| `line.copyPinned` | Copy pinned | कॉपी तय है |
| `line.tierShort` | tier {rank} | टियर {rank} |
| `finish.none` | Mill finish | मिल फ़िनिश |
| `finish.anodise` | Anodise | एनोडाइज़ |
| `finish.pvd` | PVD | PVD |
| `weightBasis.copy_current` | Copy's latest weight | कॉपी का ताज़ा वज़न |
| `weightBasis.band_start` | Band start | बैंड की शुरुआत |
| `qtyBasis.pcs` | By pieces | पीस से |
| `qtyBasis.kg` | By kg | kg से |
| `ordered` | Ordered | ऑर्डर |
| `dispatched` | Dispatched | Dispatch हुआ |
| `baki` | Baki | बाकी |
| `planable` | Can still plan | अभी प्लान हो सकता है |
| `over` | Over by {kg} kg | {kg} kg ज़्यादा |
| `confirm` | Confirm order | ऑर्डर पक्का करें |
| `close` | Close order | ऑर्डर बंद करें |
| `cancel` | Cancel order | ऑर्डर रद्द करें |
| `closeReason` | Why close with baki left | बाकी रहते हुए क्यों बंद कर रहे हैं |
| `cancelReason` | Why cancel | क्यों रद्द कर रहे हैं |
| `poRepeat` | PO {po} is already on order {code}. | PO {po} पहले से ऑर्डर {code} पर है। |
| `blockers.po_number` | Add the PO number. | PO नंबर डालें। |
| `blockers.no_lines` | Add at least one line. | कम से कम एक लाइन जोड़ें। |
| `blockers.line` | Line {n}: {problem} | लाइन {n}: {problem} |
| `blockers.pcs` | add pieces | पीस डालें |
| `blockers.kg` | add kg | kg डालें |
| `blockers.length` | add the cut length | कट लंबाई डालें |
| `blockers.alloy` | add the alloy | अलॉय डालें |
| `blockers.temper` | add the temper | टेम्पर डालें |
| `blockers.die_or_tier` | pick a copy or a tier | कॉपी या टियर चुनें |
| `hold.title` | Put on sales order | सेल्स ऑर्डर पर रखें |
| `hold.action` | Hold for this line | इस लाइन के लिए होल्ड करें |
| `hold.pick` | Pick bundles in the yard | यार्ड से bundle चुनें |
| `hold.heldInYard` | Held in yard | यार्ड में होल्ड |
| `hold.heldKg` | {kg} kg held in yard | यार्ड में {kg} kg होल्ड |
| `hold.heldFor` | Held for {order} | {order} के लिए होल्ड |
| `hold.held` | {count} {count:bundle\|bundles} held | {count} bundle होल्ड किए |
| `hold.already` | Already held for this line | इस लाइन के लिए पहले से होल्ड है |
| `hold.lengthMismatch` | The cut length differs from the order line | कट लंबाई ऑर्डर लाइन से अलग है |
| `hold.tooMany` | Hold at most {max} bundles at a time. | एक बार में ज़्यादा से ज़्यादा {max} bundle होल्ड करें। |
| `hold.note` | Note | नोट |
| `hold.empty` | Nothing is held for this line. | इस लाइन के लिए कुछ होल्ड नहीं है। |
| `hold.release` | Release | होल्ड हटाएं |
| `hold.releaseAll` | Release all | सब होल्ड हटाएं |
| `hold.released` | {count} {count:bundle\|bundles} released | {count} bundle से होल्ड हटा |
| `hold.button` | Hold stock | स्टॉक होल्ड करें |
| `hold.sheetTitle` | Hold stock for line {n} | लाइन {n} के लिए स्टॉक होल्ड करें |
| `hold.hint` | Yard bundles of this die on no order, or on this line. They stay where they are; while held, no other customer's dispatch can take them. | इस die के यार्ड bundle जो किसी ऑर्डर पर नहीं हैं, या इसी लाइन पर हैं। वे जहां हैं वहीं रहते हैं; होल्ड रहने तक किसी और ग्राहक का dispatch उन्हें नहीं ले सकता। |
| `hold.none` | No yard bundles of this die can be held for this line. | इस die का कोई यार्ड bundle इस लाइन के लिए होल्ड नहीं किया जा सकता। |
| `hold.submit` | Hold {count} {count:bundle\|bundles} | {count} bundle होल्ड करें |
| `hold.heldDone` | Held {count} {count:bundle\|bundles} ({kg} kg) | {count} bundle होल्ड किए ({kg} kg) |
| `hold.alreadyList` | Already held: {serials} | पहले से होल्ड: {serials} |
| `hold.lengthWarning` | {serial} is {length}; the line is {lineLength}. Held anyway. | {serial} की लंबाई {length} है; लाइन {lineLength} की है। फिर भी होल्ड किया। |
| `hold.chip` | Held: {count} {count:bundle\|bundles} · {kg} kg | होल्ड: {count} bundle · {kg} kg |
| `hold.list` | Held bundles | होल्ड bundle |
| `hold.listTitle` | Held for line {n} | लाइन {n} के लिए होल्ड |
| `hold.onDispatch` | On {code} | {code} पर |
| `hold.releaseSelected` | Release {count} | {count} से होल्ड हटाएं |
| `hold.refused.line_closed` | The order is not open | ऑर्डर खुला नहीं है |
| `hold.refused.not_available` | Not in the yard | यार्ड में नहीं है |
| `hold.refused.on_dispatch` | On a dispatch | dispatch पर है |
| `hold.refused.pending_reallocation` | Waiting on a reallocation approval | reallocation की मंज़ूरी बाकी है |
| `hold.refused.die_mismatch` | Different die | दूसरी die |
| `hold.refused.other_line` | On another order line; move it instead | दूसरी ऑर्डर लाइन पर है; उसे वहां से डालें |
| `hold.refused.held_elsewhere` | Held for another order line | दूसरी ऑर्डर लाइन के लिए होल्ड पर है |
| `subtitle` | Customer POs and what is still to dispatch | ग्राहकों के PO और जो dispatch होना बाकी है |
| `filter.label` | Show | दिखाएं |
| `filter.open` | Open | खुले |
| `filter.closed` | Closed | बंद |
| `filter.cancelled` | Cancelled | रद्द |
| `search` | Number, PO or customer | नंबर, PO या ग्राहक |
| `searchLabel` | Search orders | ऑर्डर खोजें |
| `customer` | Customer | ग्राहक |
| `po` | PO | PO |
| `noPo` | No PO yet | अभी PO नहीं |
| `late` | Late, {days} days | लेट, {days} दिन |
| `list.status` | Status | स्थिति |
| `list.ordered` | Ordered kg | ऑर्डर kg |
| `list.baki` | Baki kg | बाकी kg |
| `empty.title` | No orders yet | अभी कोई ऑर्डर नहीं |
| `empty.body` | Book a customer's PO to start an order. | ग्राहक का PO बुक करके ऑर्डर शुरू करें। |
| `empty.noMatch` | No orders match | कोई ऑर्डर नहीं मिला |
| `empty.noMatchBody` | Try another number, PO or customer. | दूसरा नंबर, PO या ग्राहक आज़माएं। |
| `empty.filtered` | Nothing under {status} | {status} में कुछ नहीं |
| `strip.label` | Balance figures | बाकी के आंकड़े |
| `strip.ordered` | Ordered | ऑर्डर |
| `strip.planned` | Planned | प्लान |
| `strip.pressed` | Pressed | प्रेस हुआ |
| `strip.aged` | Aged | एजिंग |
| `strip.packed` | Packed (incl. on a truck) | पैक (गाड़ी पर रखे सहित) |
| `strip.inStock` | In stock | स्टॉक में |
| `strip.dispatched` | Dispatched | Dispatch हुआ |
| `strip.baki` | Baki | बाकी |
| `totals.title` | Balance | हिसाब |
| `totals.ordered` | Ordered | ऑर्डर |
| `totals.produced` | Produced | बना |
| `totals.dispatched` | Dispatched | Dispatch हुआ |
| `totals.baki` | Baki | बाकी |
| `bakiNote` | Baki is ordered minus dispatched. It does not go below zero. | बाकी = ऑर्डर घटा dispatch। यह शून्य से नीचे नहीं जाता। |
| `confirmed` | Order confirmed | ऑर्डर पक्का हो गया |
| `closed` | Order closed | ऑर्डर बंद हो गया |
| `cancelled` | Order cancelled | ऑर्डर रद्द हो गया |
| `toConfirm` | To confirm this order | ऑर्डर पक्का करने के लिए |
| `closeBakiHint` | {kg} kg is still to dispatch. Say why you are closing it. | {kg} kg अभी dispatch होना बाकी है। बंद करने का कारण लिखें। |
| `pending.title` | Waiting for a manager | मैनेजर का इंतज़ार |
| `pending.line` | {count} {count:bundle\|bundles}, {kg} kg, to {order} {customer} | {count} bundle, {kg} kg, {order} {customer} को |
| `detail.dispatch` | Dispatch | Dispatch |
| `detail.filter.label` | Filter the lines | लाइनें छांटें |
| `detail.filter.die` | Die | Die |
| `detail.filter.anyDie` | Any die | कोई भी die |
| `detail.filter.length` | Cut length | कट लंबाई |
| `detail.filter.anyLength` | Any length | कोई भी लंबाई |
| `detail.filter.stage` | Stage | स्टेज |
| `detail.filter.hasBaki` | Has baki | बाकी है |
| `detail.filter.shown` | {shown} of {total} lines | {total} में से {shown} लाइनें |
| `detail.filter.pcsMissing` | {n} lines without pieces | {n} लाइनों में पीस नहीं |
| `detail.filter.none` | No line matches these filters. | इन फ़िल्टर से कोई लाइन नहीं मिली। |
| `detail.lines` | Lines | लाइनें |
| `detail.lineShort` | Line {n} | लाइन {n} |
| `detail.moveBundles` | Move bundles | Bundle डालें |
| `detail.basisLineBare` | Weight basis {milli} kg/12ft. | वज़न आधार {milli} kg/12ft। |
| `detail.basisLine` | Weight basis {milli} kg/12ft ({basis}). | वज़न आधार {milli} kg/12ft ({basis})। |
| `detail.implied` | {pcs} pcs weigh {implied} kg at that basis. | इस आधार पर {pcs} पीस का वज़न {implied} kg। |
| `detail.rate` | Rs {rate}/kg | Rs {rate}/kg |
| `detail.timeline` | Timeline | टाइमलाइन |
| `detail.timelineEmpty` | Nothing has happened yet. | अभी कुछ नहीं हुआ। |
| `detail.notFound` | This order was not found | यह ऑर्डर नहीं मिला |
| `detail.editLines` | Edit lines | लाइनें बदलें |
| `detail.saveLines` | Save lines | लाइनें सेव करें |
| `detail.refreshWeight` | Refresh weight | वज़न ताज़ा करें |
| `detail.weightRefreshed` | Line {n}: weight basis refreshed | लाइन {n}: वज़न आधार ताज़ा किया |
| `detail.takeStock` | Take ready stock | तैयार स्टॉक लें |
| `edit.title` | Edit order | ऑर्डर बदलें |
| `edit.saved` | Order saved | ऑर्डर सेव हुआ |
| `edit.linesTitle` | Edit the lines | लाइनें बदलें |
| `edit.linesHint` | Pieces or kg, length, die and copy. A line on a released press plan keeps its figures. | पीस या kg, लंबाई, die और कॉपी। प्रेस को भेजे गए प्लान की लाइन के आंकड़े नहीं बदलते। |
| `edit.linesSaved` | Lines saved | लाइनें सेव हुईं |
| `edit.releasedPlan` | Line {lines} is on a released press plan. Its kg, pieces, length and die can't change now. | लाइन {lines} प्रेस को भेजे गए प्लान पर है। इसके kg, पीस, लंबाई और die अभी नहीं बदल सकते। |
| `edit.belowDispatched` | Line {line}: {dispatched} kg is already dispatched, more than the new {kg} kg. | लाइन {line}: {dispatched} kg पहले ही dispatch हो चुका है, नए {kg} kg से ज़्यादा। |
| `ownedBy` | This die belongs to {name}. | यह die {name} की है। |
| `form.expectedHint` | Starts {days} {days:day\|days} after the order date. Change it if the customer wants it sooner or later. | ऑर्डर की तारीख से {days} दिन बाद से शुरू होता है। ग्राहक को जल्दी या देर से चाहिए तो बदलें। |
| `form.orderTotal` | This order: {lines} {lines:length\|lengths}, {pcs} pcs, {kg} kg | यह ऑर्डर: {lines} लंबाई, {pcs} पीस, {kg} kg |
| `form.block.title` | Die {n} | Die {n} |
| `form.block.remove` | Remove die {n} | Die {n} हटाएं |
| `form.block.lengths` | Cut lengths | कट लंबाइयां |
| `form.block.lengthN` | Length {n} | लंबाई {n} |
| `form.block.addLength` | Add a length | लंबाई जोड़ें |
| `form.block.addDie` | Add another die | एक और die जोड़ें |
| `form.block.copy` | Copy | कॉपी |
| `form.block.copyLength` | Copy length {n} | लंबाई {n} की कॉपी |
| `form.block.removeLength` | Remove length {n} | लंबाई {n} हटाएं |
| `form.block.subtotal` | This die: {lines} {lines:length\|lengths}, {pcs} pcs, {kg} kg | यह die: {lines} लंबाई, {pcs} पीस, {kg} kg |
| `form.block.share` | {pct}% of the order | ऑर्डर का {pct}% |
| `form.block.enterHint` | Press Enter in pieces or kg to add the next length. Shift and Enter add another die. | अगली लंबाई जोड़ने के लिए पीस या kg में Enter दबाएं। Shift और Enter से एक और die जुड़ती है। |
| `form.block.more` | Alloy, temper, finish and weight basis | अलॉय, टेम्पर, फ़िनिश और वज़न का आधार |
| `form.subtitle` | Book a customer's PO. Confirm it on the order once the PO number and every line are complete. | ग्राहक का PO बुक करें। PO नंबर और हर लाइन पूरी होने पर ऑर्डर पर पक्का करें। |
| `form.party` | Customer and PO | ग्राहक और PO |
| `form.customerSearch` | Search customers | ग्राहक खोजें |
| `form.dieSearch` | Search by die code or name | Die कोड या नाम से खोजें |
| `form.poHint` | Needed to confirm. A PO number can be used once per customer. | पक्का करने के लिए ज़रूरी। एक ग्राहक का PO नंबर एक ही बार चलता है। |
| `form.poPlaceholder` | Customer's PO number | ग्राहक का PO नंबर |
| `form.lineTitle` | Line {n} | लाइन {n} |
| `form.removeLine` | Remove line {n} | लाइन {n} हटाएं |
| `form.addLine` | Add another line | एक और लाइन जोड़ें |
| `form.book` | Book order | ऑर्डर बुक करें |
| `form.saved` | Order {number} booked | ऑर्डर {number} बुक हुआ |
| `form.feet` | Feet | फ़ीट |
| `form.inches` | Inches | इंच |
| `form.lengthHintInch` | Feet and inches | फ़ीट और इंच |
| `form.lengthHintMm` | Millimetres | मिलीमीटर |
| `form.quickLengths` | Common lengths | आम लंबाइयां |
| `form.weightBasis` | Weight basis | वज़न आधार |
| `form.basisCurrent` | Current | ताज़ा |
| `form.basisBandStart` | Band start | बैंड की शुरुआत |
| `form.basisUsingCopy` | Using {milli} kg/12ft, the latest weight of copy {copy}. | {milli} kg/12ft ले रहे हैं, कॉपी {copy} का ताज़ा वज़न। |
| `form.basisUsingBand` | Using {milli} kg/12ft, the start of the die's band. | {milli} kg/12ft ले रहे हैं, die के बैंड की शुरुआत। |
| `form.noReading` | No weight reading on the copy yet; band start used. | कॉपी का अभी कोई वज़न नहीं है; बैंड की शुरुआत ली गई। |
| `form.quoteLine` | {pcs} pcs come to {kg} kg. | {pcs} पीस = {kg} kg। |
| `form.impliedLine` | {pcs} pcs weigh {implied} kg. You typed {kg} kg. | {pcs} पीस का वज़न {implied} kg है। आपने {kg} kg डाला। |
| `form.minusPiece` | -1 piece | -1 पीस |
| `form.plusPiece` | +1 piece | +1 पीस |
| `form.quoteFailed` | Could not work out the other side. Check the die and the length. | दूसरी तरफ़ का हिसाब नहीं निकला। Die और लंबाई देखें। |
| `form.quoting` | Working out… | हिसाब लग रहा है… |
| `form.basisLocked` | Using {milli} kg/12ft, locked when this line was booked. | {milli} kg/12ft ले रहे हैं, जो लाइन बुक होते समय तय हुआ। |
| `form.errors.customer` | Pick the customer. | ग्राहक चुनें। |
| `form.errors.die` | Pick the die. | Die चुनें। |
| `form.errors.length` | Enter the cut length. | कट लंबाई डालें। |
| `form.errors.qty` | Enter pieces or kg. | पीस या kg डालें। |
| `stock.title` | Stock for this die and length | इस die और लंबाई का स्टॉक |
| `stock.hint` | Bundles of this die that are already made. Book the order, then use Take ready stock on its line to put them on it. | इस die के बने हुए bundle। ऑर्डर बुक करें, फिर उसकी लाइन पर "तैयार स्टॉक लें" से इन्हें उस पर डालें। |
| `stock.takeTitle` | Ready stock for line {n} | लाइन {n} के लिए तैयार स्टॉक |
| `stock.takeHint` | Plant stock and bundles not on an order go on this line at once. Another customer's bundles wait for a manager. | प्लांट स्टॉक और बिना ऑर्डर के bundle तुरंत इस लाइन पर आते हैं। दूसरे ग्राहक के bundle मैनेजर की मंज़ूरी के बाद। |
| `stock.putOnLine` | Put on this line | इस लाइन पर डालें |
| `stock.noneToTake` | No ready stock of this die to take. | इस die का लेने लायक तैयार स्टॉक नहीं है। |
| `stock.prompt` | Ready stock of this die: {count} {count:bundle\|bundles}, {kg} kg. | इस die का तैयार स्टॉक: {count} bundle, {kg} kg। |
| `stock.promptNone` | No ready stock of this die. | इस die का तैयार स्टॉक नहीं है। |
| `stock.open` | See stock | स्टॉक देखें |
| `stock.none` | No ready stock for this die. | इस die का तैयार स्टॉक नहीं है। |
| `stock.sameLength` | Same length | वही लंबाई |
| `stock.needsApproval` | Needs a manager | मैनेजर की मंज़ूरी |
| `stock.group.plant` | Plant stock | प्लांट स्टॉक |
| `stock.group.unassigned` | Not on an order | किसी ऑर्डर पर नहीं |
| `stock.group.same_customer` | This customer's orders | इसी ग्राहक के ऑर्डर |
| `stock.group.other_customer` | Another customer's orders | दूसरे ग्राहक के ऑर्डर |
| `timeline.portalCreate` | Booked by the party from the portal | पार्टी ने पोर्टल से बुक किया |
| `timeline.create` | Order booked | ऑर्डर बुक हुआ |
| `timeline.update` | Order edited | ऑर्डर बदला गया |
| `timeline.confirm` | Order confirmed | ऑर्डर पक्का हुआ |
| `timeline.close` | Order closed | ऑर्डर बंद हुआ |
| `timeline.cancel` | Order cancelled | ऑर्डर रद्द हुआ |
| `timeline.weightRefresh` | Weight basis refreshed | वज़न आधार ताज़ा किया |
| `timeline.reallocatePending` | {count} {count:bundle\|bundles}, {kg} kg, asked to move. Waiting for a manager. | {count} bundle, {kg} kg डालने की मांग। मैनेजर का इंतज़ार। |
| `timeline.reallocateApplied` | {count} {count:bundle\|bundles}, {kg} kg, moved | {count} bundle, {kg} kg डाले गए |
| `timeline.reallocateRejected` | The move of {count} {count:bundle\|bundles} was refused | {count} bundle डालना मना किया गया |
| `timeline.moveApplied` | {count} {count:bundle\|bundles}, {kg} kg, moved from {from} to {to} | {count} bundle, {kg} kg, {from} से {to} को ले जाए गए |
| `timeline.movePending` | {count} {count:bundle\|bundles}, {kg} kg, from {from} to {to}, asked. Waiting for a manager. | {count} bundle, {kg} kg, {from} से {to} को, मांगा गया। मैनेजर का इंतज़ार। |
| `timeline.moveRejected` | The move of {count} {count:bundle\|bundles}, {kg} kg, from {from} to {to} was refused | {count} bundle, {kg} kg, {from} से {to} को ले जाना मना किया गया |
| `timeline.plantStock` | plant stock | प्लांट स्टॉक |
| `timeline.hold` | {count} {count:bundle\|bundles}, {kg} kg, held for line {line} | {count} bundle, {kg} kg, लाइन {line} के लिए होल्ड |
| `timeline.release` | Hold on line {line} ended: {count} {count:bundle\|bundles}, {kg} kg | लाइन {line} का होल्ड हटा: {count} bundle, {kg} kg |
| `timeline.releaseDispatched` | {count} held {count:bundle\|bundles}, {kg} kg, left on {code} | होल्ड के {count} bundle, {kg} kg, {code} पर गए |
| `timeline.planCreate` | Press plan {number} drafted | प्रेस प्लान {number} बना |
| `timeline.planRelease` | Press plan {number} released to the press | प्रेस प्लान {number} प्रेस को भेजा गया |
| `timeline.planCancel` | Press plan {number} cancelled | प्रेस प्लान {number} रद्द हुआ |
| `timeline.planClose` | Press plan {number} closed | प्रेस प्लान {number} बंद हुआ |
| `timeline.planUpdate` | Press plan {number} changed | प्रेस प्लान {number} बदला गया |
| `timeline.packed` | Bundles packed for this order | इस ऑर्डर के लिए bundle पैक हुए |
| `timeline.dispatched` | Dispatch completed | Dispatch पूरा हुआ |
| `timeline.overdraw` | More than ordered was asked for on a dispatch | Dispatch पर ऑर्डर से ज़्यादा मांगा गया |
| `timeline.other` | {action} | {action} |
| `plan.view.label` | View | देखें |
| `plan.view.die` | By die | Die के हिसाब से |
| `plan.view.order` | By order | ऑर्डर के हिसाब से |
| `plan.view.flat` | All lines | सारी लाइनें |
| `plan.draftOrders` | {orders} {orders:sales order\|sales orders} on the draft | ड्राफ़्ट में {orders} ऑर्डर |
| `plan.openOrder` | Open the order | ऑर्डर खोलें |
| `plan.subtitle` | Group open lines by die, set the window, release to the press. | खुली लाइनें die के हिसाब से जोड़ें, समय तय करें, प्रेस को भेजें। |
| `plan.biggerTitle` | Use a bigger screen | बड़ी स्क्रीन पर खोलें |
| `plan.biggerBody` | The press plan needs a desktop or an 11-inch tablet. Open it there to plan. | प्रेस प्लान के लिए डेस्कटॉप या 11 इंच का टैबलेट चाहिए। प्लान वहीं खोलें। |
| `plan.recent` | Plans | प्लान |
| `plan.noPlans` | No press plans yet. | अभी कोई प्रेस प्लान नहीं। |
| `plan.summary` | {dies} {dies:die\|dies}, {kg} kg | {dies} die, {kg} kg |
| `plan.from` | Window starts | समय शुरू |
| `plan.to` | Window ends | समय खत्म |
| `plan.windowHint` | A window is at most 24 hours. | एक प्लान का समय ज़्यादा से ज़्यादा 24 घंटे। |
| `plan.windowLong` | The window is longer than 24 hours. | समय 24 घंटे से ज़्यादा है। |
| `plan.windowOrder` | The window must end after it starts. | खत्म होने का समय शुरू के बाद होना चाहिए। |
| `plan.windowShown` | Production day {day}: {from} to {to}, plant time | प्रोडक्शन दिन {day}: {from} से {to} तक, प्लांट का समय |
| `plan.atToday` | today {time} | आज {time} |
| `plan.atTomorrow` | tomorrow {time} | अगले दिन {time} |
| `plan.atOther` | {date} {time} | {date} {time} |
| `plan.openLines` | Open lines | खुली लाइनें |
| `plan.searchPlaceholder` | Die, customer or PO | Die, ग्राहक या PO |
| `plan.searchLabel` | Search open lines | खुली लाइनें खोजें |
| `plan.allCustomers` | All customers | सभी ग्राहक |
| `plan.nothingLeft` | Nothing left to plan | प्लान करने को कुछ नहीं |
| `plan.nothingLeftBody` | Open lines are in stock or already on a plan. | खुली लाइनें स्टॉक में हैं या पहले से किसी प्लान में हैं। |
| `plan.planable` | {kg} kg to plan | {kg} kg प्लान हो सकता है |
| `plan.addLine` | Add {order} to the plan | {order} को प्लान में जोड़ें |
| `plan.draftDies` | Dies in run order | चलने के क्रम में die |
| `plan.chooseLines` | Choose lines | लाइनें चुनें |
| `plan.chooseLinesBody` | One die groups every customer that needs it. | एक die उसे चाहने वाले सब ग्राहकों को एक साथ रखता है। |
| `plan.markUrgent` | Mark urgent | जल्दी करें |
| `plan.moveEarlier` | Move earlier | पहले करें |
| `plan.moveLater` | Move later | बाद में करें |
| `plan.otherParty` | {die} is also open for {customer} on {order} ({length}): {kg} kg still to plan. | {die} पर {customer} का {order} ({length}) भी खुला है: {kg} kg प्लान होना बाकी। |
| `plan.otherLinesTitle` | Other open lines on these dies | इन die पर दूसरी खुली लाइनें |
| `plan.otherLinesBody` | Add them to press them in the same run. | इन्हें जोड़ें तो एक ही रन में दबेंगी। |
| `plan.otherLinesNone` | No other open line on these dies. | इन die पर कोई और खुली लाइन नहीं। |
| `plan.planableBoth` | {kg} kg, {pcs} pcs to plan | {kg} kg, {pcs} पीस प्लान होना बाकी |
| `plan.addAllOfSo` | Add all of {order} | {order} की सब लाइनें जोड़ें |
| `plan.draftFooter` | {dies} {dies:die\|dies}, {lines} {lines:line\|lines} | {dies} die, {lines} लाइन |
| `plan.moreLines` | More open lines than shown. Narrow by customer or search. | दिखाई गई से ज़्यादा खुली लाइनें हैं। ग्राहक या खोज से छांटें। |
| `plan.added` | Added to the plan | प्लान में जोड़ा |
| `plan.removed` | Taken off the plan | प्लान से हटाया |
| `plan.lineKg` | kg for {order} | {order} के लिए kg |
| `plan.lineKgHint` | Blank = all that is left to plan | खाली = जितना प्लान होना बाकी है सब |
| `plan.pressLine` | Press | प्रेस |
| `plan.pickPressLine` | Pick the press | प्रेस चुनें |
| `plan.saveDraft` | Save draft plan | ड्राफ़्ट प्लान सेव करें |
| `plan.trial.hint` | A trial or sample plan has no order lines. It makes one queued run per die. | ट्रायल या सैंपल प्लान में ऑर्डर लाइन नहीं होती। हर die की एक queued रन बनती है। |
| `plan.trial.die` | Die | Die |
| `plan.trial.diePlaceholder` | Search dies | Die खोजें |
| `plan.trial.copy` | Die copy | Die कॉपी |
| `plan.trial.copyPlaceholder` | Pick a copy (optional) | कॉपी चुनें (वैकल्पिक) |
| `plan.trial.copyHintTrial` | Only copies on trial can go to a die trial. The die room issues the copy to the run. | Die ट्रायल पर सिर्फ़ ट्रायल वाली कॉपी जा सकती है। Die room कॉपी को रन पर जारी करता है। |
| `plan.trial.copyHint` | The die room issues the copy to the run. | Die room कॉपी को रन पर जारी करता है। |
| `plan.trial.kg` | Planned kg | प्लान किया kg |
| `plan.trial.pcs` | Planned pieces | प्लान किए पीस |
| `plan.trial.qtyHint` | Optional. Kept in the plan note for the die room and the press. | वैकल्पिक। Die room और प्रेस के लिए प्लान के नोट में रहता है। |
| `plan.trial.note` | Note | नोट |
| `plan.trial.needDie` | Pick the die. | Die चुनें। |
| `plan.trial.badKg` | Enter a kg figure, or leave it blank. | kg की संख्या लिखें, या खाली छोड़ें। |
| `plan.trial.badPcs` | Enter whole pieces, or leave it blank. | पूरे पीस लिखें, या खाली छोड़ें। |
| `plan.released` | Plan released to the press | प्लान प्रेस को भेजा गया |
| `plan.cancelled` | Plan cancelled | प्लान रद्द हुआ |
| `plan.closed` | Plan closed | प्लान बंद हुआ |
| `plan.releaseTitle` | Release {number} | {number} भेजें |
| `plan.releaseHint` | The die room picks the copy at issue. Each die becomes one queued run. | कॉपी die room निकालते समय चुनता है। हर die एक कतार का रन बनता है। |
| `plan.releaseNow` | Release to press | प्रेस को भेजें |
| `plan.warningsTitle` | Other customers are waiting on these dies too | इन die पर दूसरे ग्राहक भी इंतज़ार में हैं |
| `plan.notFound` | This plan was not found | यह प्लान नहीं मिला |

### reallocate (28)

| Key | English | हिंदी |
|---|---|---|
| `title` | Move to another order | दूसरे ऑर्डर में डालें |
| `toLine` | Move to | कहां डालें |
| `toPlant` | Plant stock | प्लांट स्टॉक |
| `unassigned` | Not on an order | किसी ऑर्डर पर नहीं |
| `reasonCode` | Reason | कारण |
| `lengthMismatch` | The cut length differs from the order line. Pick a reason. | कट लंबाई ऑर्डर लाइन से अलग है। कारण चुनें। |
| `needsApproval` | This is another customer's order. A manager approves the move. | यह दूसरे ग्राहक का ऑर्डर है। मैनेजर मंज़ूरी देंगे। |
| `moved` | {count} {count:bundle\|bundles} moved | {count} bundle डाले गए |
| `tooMany` | Move at most {max} bundles at a time. | एक बार में ज़्यादा से ज़्यादा {max} bundle डालें। |
| `from` | From {order}, line {line} | {order} लाइन {line} से |
| `bundles` | Bundles | Bundle |
| `selectAll` | Select all | सब चुनें |
| `clearAll` | Clear | साफ़ करें |
| `noneToMove` | No bundle on this line can move. Only available bundles move. | इस लाइन का कोई bundle नहीं डाला जा सकता। सिर्फ़ उपलब्ध bundle डलते हैं। |
| `leave` | Leave them | रहने दें |
| `move` | Move | डालें |
| `plantNote` | Plant stock applies at once. It is not a customer. | प्लांट स्टॉक में तुरंत हो जाता है। यह ग्राहक नहीं है। |
| `lengthWarning` | The cut length differs from {order} line {line} ({length}) for {count} {count:bundle\|bundles}. Pick a reason. | {count} bundle की लंबाई {order} लाइन {line} की कट लंबाई ({length}) से अलग है। कारण चुनें। |
| `reasonNone` | Choose a reason | कारण चुनें |
| `reasonNeeded` | Pick a reason or write a note. | कारण चुनें या नोट लिखें। |
| `pickBundles` | Pick the bundles to move. | डालने के लिए bundle चुनें। |
| `waiting` | Waiting for a manager | मैनेजर का इंतज़ार |
| `waitingBody` | {count} {count:bundle\|bundles}, {kg} kg, stay where they are until a manager approves. | {count} bundle, {kg} kg मैनेजर की मंज़ूरी तक जहां हैं वहीं रहेंगे। |
| `openRequest` | See the request | मांग देखें |
| `refused.dispatched` | Already dispatched | पहले ही dispatch हो चुका |
| `refused.void` | Void | रद्द |
| `refused.held` | Held on {code} | {code} पर होल्ड |
| `refused.die_mismatch` | Different die | दूसरी die |

### press (493)

| Key | English | हिंदी |
|---|---|---|
| `title` | Press | प्रेस |
| `lines.title` | Press lines | प्रेस लाइन |
| `lines.add` | Add press | प्रेस जोड़ें |
| `lines.code` | Code | कोड |
| `lines.name` | Name | नाम |
| `lines.tonnage` | Tonnes | टन |
| `lines.retire` | Retire | बंद करें |
| `plan.title` | Press plan | प्रेस प्लान |
| `plan.purpose.label` | Purpose | किस लिए |
| `plan.purpose.production` | Production | उत्पादन |
| `plan.purpose.die_trial` | Die trial | Die ट्रायल |
| `plan.purpose.sample` | Sample | सैंपल |
| `plan.purpose.other` | Other | अन्य |
| `plan.noOrderLine` | A trial or sample needs no order line. | ट्रायल या सैंपल के लिए ऑर्डर लाइन नहीं चाहिए। |
| `plan.queueOrder` | Queue order | कतार का क्रम |
| `plan.moveUp` | Move up | ऊपर करें |
| `plan.moveDown` | Move down | नीचे करें |
| `plan.pullBack` | Take back to planning | प्लानिंग में वापस लें |
| `plan.new` | New plan | नया प्लान |
| `plan.number` | Plan {number} | प्लान {number} |
| `plan.window` | From {from} to {to} | {from} से {to} तक |
| `plan.addDie` | Add die | Die जोड़ें |
| `plan.addLine` | Add order line | ऑर्डर लाइन जोड़ें |
| `plan.urgent` | Urgent | जल्दी |
| `plan.release` | Release to press | प्रेस को भेजें |
| `plan.cancel` | Cancel plan | प्लान रद्द करें |
| `plan.close` | Close plan | प्लान बंद करें |
| `plan.overPlanable` | More than the order can still take. | ऑर्डर में जितना बाकी है उससे ज़्यादा। |
| `plan.status.draft` | Draft | ड्राफ़्ट |
| `plan.status.released` | Released | भेजा गया |
| `plan.status.closed` | Closed | बंद |
| `plan.status.cancelled` | Cancelled | रद्द |
| `console.title` | Press console | प्रेस कंसोल |
| `console.queue` | Queue | कतार |
| `console.noRuns` | Nothing queued for this press. | इस प्रेस के लिए कतार में कुछ नहीं। |
| `console.run` | Run {number} | रन {number} |
| `console.status.queued` | Queued | कतार में |
| `console.status.die_issued` | Die issued | Die मिल गई |
| `console.status.running` | Running | चल रहा है |
| `console.status.stopped` | Stopped | रुका है |
| `console.status.counting` | Counting | गिनती |
| `console.status.logged` | Logged | दर्ज |
| `console.status.voided` | Void | रद्द |
| `console.start` | Start | शुरू करें |
| `console.stop` | Stop | रोकें |
| `console.resume` | Resume | फिर चालू करें |
| `console.undoStart` | Undo start | शुरू करना वापस लें |
| `console.count` | Count | गिनती करें |
| `console.close` | Close run | रन बंद करें |
| `console.reopen` | Reopen | फिर खोलें |
| `console.voidRun` | Void run | रन रद्द करें |
| `console.dieIn` | Die in | Die लगी |
| `console.dieOut` | Die out | Die उतरी |
| `console.waitingDie` | Waiting for the die room | Die रूम का इंतज़ार |
| `console.lineBusy` | Another run is on this press. | इस प्रेस पर दूसरा रन चल रहा है। |
| `console.stopReason` | Why stopped | क्यों रुका |
| `console.operator` | Operator | ऑपरेटर |
| `console.relief` | Relief operator | रिलीफ़ ऑपरेटर |
| `console.supervisor` | Supervisor | सुपरवाइज़र |
| `console.cast` | Cast | कास्ट |
| `console.shift` | Shift | शिफ्ट |
| `console.productionDay` | Day | दिन |
| `console.good` | Good kg | अच्छा kg |
| `console.reject` | Reject kg | रिजेक्ट kg |
| `console.ends` | Ends kg | टुकड़े kg |
| `console.discard` | Butt kg | बट kg |
| `console.input` | Billet kg | बिलेट kg |
| `console.recovery` | Recovery | रिकवरी |
| `console.balance` | Balance {kg} kg | बाकी {kg} kg |
| `console.balanceWarn` | Billets and output differ by more than {pct}%. | बिलेट और माल में {pct}% से ज़्यादा फ़र्क है। |
| `console.pressRemark` | Press remark | प्रेस टिप्पणी |
| `console.dieRemark` | Die remark | Die टिप्पणी |
| `console.timeUnconfirmed` | Time not confirmed | समय पक्का नहीं |
| `console.billets` | Billets | बिलेट |
| `console.billetCount` | Billets | बिलेट |
| `console.billetLength` | Billet length | बिलेट लंबाई |
| `console.billetKg` | Billet kg | बिलेट kg |
| `console.addBillet` | Add billets | बिलेट जोड़ें |
| `console.tooManyBillets` | At most {max} billet rows. | ज़्यादा से ज़्यादा {max} बिलेट लाइनें। |
| `console.billetCastMismatch` | Add a billet row of this run's cast. | इस रन की cast की एक बिलेट लाइन डालें। |
| `console.billetShort` | Fewer billets in stock than typed | भरे गए से कम बिलेट स्टॉक में हैं |
| `console.billetShortReason` | Why the billets are short | बिलेट कम क्यों हैं |
| `console.pieces` | Pieces | पीस |
| `console.cutLength` | Cut length | कट लंबाई |
| `console.pcs` | Pcs | पीस |
| `console.addLength` | Add cut length | कट लंबाई जोड़ें |
| `console.hint` | About {kg} kg by the die weight | Die वज़न से लगभग {kg} kg |
| `console.rejects` | Rejects | रिजेक्ट |
| `console.noRejects` | No rejects | कोई रिजेक्ट नहीं |
| `console.rejectReason` | Reject reason | रिजेक्ट का कारण |
| `console.downtime` | Downtime | रुकावट |
| `console.downtimeStart` | Press stopped | प्रेस रुकी |
| `console.downtimeStop` | Press running again | प्रेस फिर चालू |
| `console.downtimeOpen` | Close the downtime first. | पहले रुकावट बंद करें। |
| `console.lateEntry` | Entered late | बाद में भरा |
| `console.lateEntryAsk` | Ask approval for a late entry | बाद में भरने की मंज़ूरी मांगें |
| `console.trialResult` | Trial result | ट्रायल का नतीजा |
| `console.trialPass` | Trial passed | ट्रायल पास |
| `console.trialFail` | Trial failed | ट्रायल फेल |
| `console.notSaved` | Not saved yet | अभी सेव नहीं हुआ |
| `console.logRun` | Log run | रन दर्ज करें |
| `console.supervisorOnly` | Only this run's supervisor can log it. | सिर्फ़ इस रन का सुपरवाइज़र इसे दर्ज कर सकता है। |
| `console.queuePosition` | Number {n} in queue | कतार में नंबर {n} |
| `console.startLocked` | Die not issued. Start is locked. | Die जारी नहीं हुई। शुरू करना बंद है। |
| `console.billetsShortBy` | Billets short by {kg} kg | बिलेट {kg} kg कम |
| `console.pickOrderLine` | Pick the order line for {mm} mm | {mm} mm के लिए ऑर्डर लाइन चुनें |
| `console.gates.not_counting` | Only a run being counted can be logged | सिर्फ़ गिनती वाला रन ही दर्ज हो सकता है |
| `console.gates.no_close_permission` | Only a supervisor or manager can log a run | रन सिर्फ़ सुपरवाइज़र या मैनेजर दर्ज कर सकता है |
| `console.gates.not_supervisor` | Only the run's supervisor can log it | रन सिर्फ़ उसका सुपरवाइज़र दर्ज कर सकता है |
| `console.gates.no_cast` | Pick the cast the billets came from | बिलेट जिस कास्ट के हैं, वह चुनें |
| `console.gates.no_billets` | Enter the billets used | लगे हुए बिलेट भरें |
| `console.gates.too_many_billets` | At most 10 billet rows on a run | एक रन में ज़्यादा से ज़्यादा 10 बिलेट लाइन |
| `console.gates.billet_row_invalid` | Every billet row needs a count and its kg | हर बिलेट लाइन में गिनती और kg चाहिए |
| `console.gates.billet_cast_mismatch` | Add a billet row of the run's cast | रन के कास्ट की एक बिलेट लाइन डालें |
| `console.gates.no_input` | The billets weigh nothing; enter their kg | बिलेट का वज़न शून्य है; उनका kg भरें |
| `console.gates.no_lines` | Enter the pieces by cut length | कट लंबाई के हिसाब से पीस भरें |
| `console.gates.line_without_kg` | A cut length with pieces needs its kg | जिस कट लंबाई में पीस हैं, उसका kg भरें |
| `console.gates.line_invalid` | A cut length row is not valid | एक कट लंबाई लाइन सही नहीं है |
| `console.gates.no_good` | Enter the good pieces and their kg | अच्छे पीस और उनका kg भरें |
| `console.gates.good_over_input` | Good kg is more than the billets that went in | अच्छा kg लगे हुए बिलेट से ज़्यादा है |
| `console.gates.pieces_over_pressed_length` | The pieces are longer in total than the pressed length | पीस की कुल लंबाई प्रेस हुई लंबाई से ज़्यादा है |
| `console.gates.no_qc` | Enter the rejects (0 when there were none) | रिजेक्ट भरें (न हों तो 0) |
| `console.gates.qc_row_invalid` | A reject row is not valid | एक रिजेक्ट लाइन सही नहीं है |
| `console.gates.qc_reason_missing` | Every reject needs a reason | हर रिजेक्ट का कारण चाहिए |
| `console.gates.qc_note_missing` | A reject marked Other needs a note | अन्य वाले रिजेक्ट के लिए नोट चाहिए |
| `console.gates.billet_short_reason_missing` | The billet store has less of this cast than entered; give the reason | बिलेट स्टोर में इस कास्ट के बिलेट भरे गए से कम हैं; कारण दें |
| `console.gates.time_unconfirmed` | The start or stop time is waiting for a supervisor to confirm it | शुरू या बंद का समय सुपरवाइज़र की पुष्टि का इंतज़ार कर रहा है |
| `console.gates.late_entry_unapproved` | This late entry is waiting for approval | बाद में भरा यह रन मंज़ूरी का इंतज़ार कर रहा है |
| `console.gates.downtime_open` | Stop the open downtime first | पहले खुली रुकावट बंद करें |
| `console.gates.trial_result_missing` | Say whether the die trial passed or failed | बताएं कि die ट्रायल पास हुआ या फेल |
| `console.errors.generic` | The server did not accept this. | सर्वर ने इसे स्वीकार नहीं किया। |
| `console.errors.conflict` | This changed on the server while you were working. Reload and try again. | काम करते समय सर्वर पर यह बदल गया। पेज फिर से खोलकर दोबारा कोशिश करें। |
| `console.errors.downtimeRunning` | A stoppage is already running on this press. Stop it first. | इस प्रेस पर एक स्टॉपेज पहले से चल रहा है। पहले उसे रोकें। |
| `console.errors.lateWindow` | A late entry must be from the last {days} days. | देर से भरी एंट्री पिछले {days} दिनों की ही हो सकती है। |
| `console.errors.lateStopped` | A late entry is for a run that has already stopped. | देर से भरी एंट्री उस रन की होती है जो रुक चुका है। |
| `console.errors.stopAfterStart` | The stop time must be after the start time. | रुकने का समय शुरू के समय के बाद का होना चाहिए। |
| `console.errors.dieElsewhere` | The die issued is for another run or press. Ask the die room. | जारी की गई die किसी और रन या प्रेस के लिए है। Die रूम से पूछें। |
| `console.errors.stateNow` | {number} is {state} now, so this was not saved. Reload the page. | {number} अभी "{state}" है, इसलिए यह सेव नहीं हुआ। पेज फिर से खोलें। |
| `console.errors.changedLogging` | {number} changed while it was being logged. Reload and log again. | {number} दर्ज होते समय बदल गया। पेज फिर से खोलकर दोबारा दर्ज करें। |
| `console.errors.billetsLeft` | Only {kg} kg of this cast is left in the billet store now. Check the billets and log again. | बिलेट स्टोर में इस cast का अब सिर्फ़ {kg} kg बचा है। बिलेट जाँचें और दोबारा दर्ज करें। |
| `console.errors.changedMeanwhile` | This changed while you were working. Reload and try again. | आपके काम करते समय यह बदल गया। पेज फिर से खोलकर दोबारा कोशिश करें। |
| `console.errors.alreadySaved` | This was already saved. | यह पहले ही सेव हो चुका है। |
| `console.errors.reopenWaiting` | {number} already waits for a reopen decision. | {number} को फिर खोलने का अनुरोध पहले से फ़ैसले के इंतज़ार में है। |
| `console.errors.reopenBlocked` | It cannot be reopened now: "{reason}" | इसे अभी फिर नहीं खोला जा सकता: "{reason}" |
| `console.errors.notMember` | That person is not a member of this plant. | यह व्यक्ति इस प्लांट का सदस्य नहीं है। |
| `console.errors.operatorRole` | The operator must be someone who runs the press. | ऑपरेटर वही हो सकता है जो प्रेस चलाता है। |
| `console.errors.supervisorRole` | The supervisor must be someone who can log runs. | सुपरवाइज़र वही हो सकता है जो रन दर्ज कर सकता है। |
| `console.errors.lineHasRun` | {number} is still open on {line}. Finish or void it first. | {number} अभी {line} पर खुला है। पहले उसे पूरा करें या रद्द करें। |
| `console.errors.hasStarted` | {number} has started, so this can no longer change. | {number} शुरू हो चुका है, इसलिए अब यह नहीं बदल सकता। |
| `console.errors.castCancelled` | That cast is cancelled. | वह cast रद्द है। |
| `console.errors.pickReason` | Pick a reason from the list. | सूची से कारण चुनें। |
| `console.errors.timeSkew` | This tablet's clock differs from the server's by more than 2 minutes. A supervisor confirms the time. | इस टैबलेट की घड़ी सर्वर की घड़ी से 2 मिनट से ज़्यादा अलग है। समय की पुष्टि सुपरवाइज़र करेगा। |
| `console.errors.copyOnTrial` | {code} is on trial. It goes only to a die trial run. | {code} ट्रायल पर है। वह सिर्फ़ die ट्रायल रन में जाती है। |
| `console.errors.copyIssued` | {code} is already issued to {line}. | {code} पहले ही {line} को जारी है। |
| `console.errors.copyElsewhere` | {code} is not available for this run right now. | {code} अभी इस रन के लिए उपलब्ध नहीं है। |
| `console.errors.lineExists` | There is already a press {code}. | {code} नाम का प्रेस पहले से है। |
| `console.errors.retired` | {code} is retired. | {code} बंद हो चुकी है। |
| `console.kgInvalid` | Type the kg as a number, for example 12.5. | kg को संख्या में लिखें, जैसे 12.5। |
| `console.ok` | OK | ठीक है |
| `console.draftStale` | Another device saved newer figures for this run. These are the saved figures. | किसी दूसरे डिवाइस ने इस रन के नए आंकड़े सेव किए हैं। ये सेव किए हुए आंकड़े हैं। |
| `console.lockedBody` | The die room issues the die. Start opens when it does. | Die रूम die जारी करता है। तब "शुरू करें" खुलेगा। |
| `console.readyTitle` | Die issued. Ready to start. | Die जारी हो गई। शुरू करने के लिए तैयार। |
| `console.readyBody` | Start records the time from the server clock. | "शुरू करें" सर्वर की घड़ी से समय दर्ज करता है। |
| `console.startedAt` | Started {time} | शुरू {time} |
| `console.stoppedAt` | Stopped {time} | बंद {time} |
| `console.runningFor` | Running for {time} | {time} से चल रहा है |
| `console.serverTimeNote` | Times come from the server clock, not this device. | समय सर्वर की घड़ी से आता है, इस डिवाइस से नहीं। |
| `console.stoppedTitle` | Stopped | रुका हुआ |
| `console.stoppedBody` | Count and check the run next. | अब रन की गिनती और जाँच करें। |
| `console.countAndCheck` | Count & check | गिनती और जाँच |
| `console.resumeBody` | Not finished? Start the press again. | काम पूरा नहीं हुआ? प्रेस फिर चालू करें। |
| `console.countingTitle` | Counting | गिनती |
| `console.countingBody` | Enter what came off the press. Figures below come from the server. | प्रेस से जो निकला वह दर्ज करें। नीचे के आँकड़े सर्वर के हैं। |
| `console.loggedTitle` | Logged | दर्ज हो गया |
| `console.loggedBody` | {good} kg good from {input} kg of billets. | {input} kg बिलेट से {good} kg अच्छा माल। |
| `console.voidedTitle` | Voided | रद्द |
| `console.voidedBody` | This run was voided and moved no stock. | यह रन रद्द हुआ और कोई स्टॉक नहीं हिला। |
| `console.trialBanner` | Die trial. Say whether it passed or failed when you log it. | Die ट्रायल। दर्ज करते समय बताएँ कि पास हुआ या फेल। |
| `console.sampleBanner` | Sample run. It goes against no order. | सैंपल रन। यह किसी ऑर्डर में नहीं जाता। |
| `console.otherBanner` | Other run. It goes against no order. | अन्य रन। यह किसी ऑर्डर में नहीं जाता। |
| `console.drawing` | Drawing | ड्रॉइंग |
| `console.drawingNone` | No drawing on file for this section. | इस सेक्शन की ड्रॉइंग फ़ाइल में नहीं है। |
| `console.handover` | Handover | हैंडओवर |
| `console.handoverBody` | The press man changes. The run keeps its start time. | प्रेस वाला बदलता है। रन का शुरू का समय वही रहता है। |
| `console.handoverRelief` | Takes over as relief | रिलीफ में कौन आया |
| `console.handoverSupervisor` | Supervisor | सुपरवाइज़र |
| `console.handoverNobody` | Nobody | कोई नहीं |
| `console.handoverDone` | Saved. | सेव हो गया। |
| `console.readingTitle` | Die weight | Die वज़न |
| `console.readingLabel` | Kg per 12 ft | kg प्रति 12 ft |
| `console.readingSave` | Save reading | रीडिंग सेव करें |
| `console.readingSaved` | Reading saved. | रीडिंग सेव हो गई। |
| `console.readingLast` | Last reading {kg} kg per 12 ft | पिछली रीडिंग {kg} kg प्रति 12 ft |
| `console.readingNone` | No reading yet for this die. | इस die की अभी कोई रीडिंग नहीं है। |
| `console.downtimeReason` | Why it stopped | क्यों रुका |
| `console.downtimeNote` | Note | टिप्पणी |
| `console.downtimeSince` | Stopped since {time} | {time} से बंद |
| `console.downtimeMin` | {min} min | {min} मिनट |
| `console.downtimeNone` | No stoppages yet. | अभी कोई स्टॉपेज नहीं। |
| `console.downtimeOpenWord` | Open | चालू |
| `console.steps.billets` | Billets | बिलेट |
| `console.steps.pieces` | Pieces | पीस |
| `console.steps.scrap` | Butt and ends | बट और एंड |
| `console.steps.rejects` | Rejects | रिजेक्ट |
| `console.steps.remark` | Remark and reading | टिप्पणी और रीडिंग |
| `console.saveFailed` | Could not save. What you typed is still here. | सेव नहीं हुआ। जो आपने लिखा है वह यहीं है। |
| `console.saveNext` | Save and next | सेव करें और आगे |
| `console.castPick` | Cast the billets came from | बिलेट किस cast के हैं |
| `console.castOnHand` | {kg} kg billet stock | {kg} kg बिलेट स्टॉक |
| `console.castNone` | No cast has billets in stock. | किसी cast के बिलेट स्टॉक में नहीं हैं। |
| `console.castClosedChip` | Closed | बंद |
| `console.weighedKg` | Weighed kg | तौला हुआ kg |
| `console.billetsOnce` | One cast on a run. A second cast is a new run. | एक रन पर एक cast। दूसरी cast नया रन है। |
| `console.shortStock` | The billet stock shows {kg} kg for this cast. The run is logged with the weighed kg; the cast will show billets short by {short} kg. Say why the stock is short. | इस cast के लिए बिलेट स्टॉक में {kg} kg दिख रहा है। रन तोले हुए kg के साथ दर्ज होगा; cast पर बिलेट {short} kg कम दिखेंगे। बताएं कि स्टॉक कम क्यों है। |
| `console.shortStockNoFigure` | The billet stock shows {kg} kg for this cast. The run is logged with the weighed kg; the cast will show the billets short. Say why the stock is short. | इस cast के लिए बिलेट स्टॉक में {kg} kg दिख रहा है। रन तोले हुए kg के साथ दर्ज होगा; cast पर बिलेट कम दिखेंगे। बताएं कि स्टॉक कम क्यों है। |
| `console.pressedLength` | Pressed length | प्रेस की लंबाई |
| `console.pressedLengthHint` | Optional. Pieces times cut length are checked only when this is set. | वैकल्पिक। भरने पर ही पीस गुणा कट लंबाई की जाँच होती है। |
| `console.pcsOrdered` | Released {pcs} pcs | भेजे गए {pcs} पीस |
| `console.forOrder` | For {order} | {order} के लिए |
| `console.noOrderFor` | No order line | ऑर्डर लाइन नहीं |
| `console.buttHint` | The butt cut off the billet end. | बिलेट के सिरे का बट। |
| `console.endsHint` | Cut ends of the pieces. | पीस के कटे हुए सिरे। |
| `console.rejectsHint` | Type 0 when there were none. A blank is not a check. | कोई नहीं था तो 0 लिखें। खाली जाँच नहीं है। |
| `console.rejectPcs` | Reject pieces | रिजेक्ट पीस |
| `console.checkedNone` | Checked, none | जाँचा, कोई नहीं |
| `console.rejectNote` | Note | टिप्पणी |
| `console.previewTitle` | Close preview | बंद करने का पूर्वावलोकन |
| `console.orderLine` | Order line | ऑर्डर लाइन |
| `console.pickOne` | Pick one | एक चुनें |
| `console.bolster` | Bolster {no} | बोल्स्टर {no} |
| `console.save` | Save | सेव करें |
| `console.cancel` | Cancel | रद्द करें |
| `console.remove` | Remove | हटाएँ |
| `console.urgent` | Urgent | जल्दी |
| `console.noteRequired` | Write a note when you pick Other. | अन्य चुनें तो टिप्पणी लिखें। |
| `console.required` | Required | ज़रूरी |
| `console.loading` | Loading | खुल रहा है |
| `console.retry` | Try again | फिर कोशिश करें |
| `console.reason` | Reason | कारण |
| `console.voidWhy` | Why void this run? Nothing was pressed, so it moves no stock. | यह रन रद्द क्यों करना है? कुछ प्रेस नहीं हुआ, इसलिए कोई स्टॉक नहीं हिलेगा। |
| `console.balanceLabel` | Balance | बैलेंस |
| `console.addReject` | Add another reject | एक और रिजेक्ट जोड़ें |
| `console.previewNote` | Not saved. These figures are the server's; they are saved when the run is logged. | सेव नहीं हुआ। ये आँकड़े सर्वर के हैं और रन दर्ज होने पर सेव होते हैं। |
| `console.recoveryNow` | Recovery | रिकवरी |
| `console.balanceOk` | Balance {kg} kg | बैलेंस {kg} kg |
| `console.gatesTitle` | Before this run can be logged | रन दर्ज होने से पहले |
| `console.readyToLog` | Ready to log. | दर्ज करने के लिए तैयार। |
| `console.waitingSupervisor` | A supervisor logs this run. Everything is saved. | रन सुपरवाइज़र दर्ज करता है। सब कुछ सेव है। |
| `console.logging` | Logging | दर्ज हो रहा है |
| `console.logFailed` | The run was not logged. | रन दर्ज नहीं हुआ। |
| `console.loggedDone` | Run logged. Recovery {pct}%. | रन दर्ज हो गया। रिकवरी {pct}%। |
| `console.reopenAsk` | Request reopen | फिर खोलने का अनुरोध |
| `console.reopenWhy` | Why does it need to reopen? | फिर क्यों खोलना है? |
| `console.reopenSent` | Reopen requested. A manager decides. | अनुरोध भेजा गया। मैनेजर तय करेगा। |
| `console.reopenPending` | Waiting for a manager to decide the reopen. | मैनेजर के फ़ैसले का इंतज़ार है। |
| `console.timeAsk` | Ask a supervisor to confirm the times | सुपरवाइज़र से समय पक्का करने को कहें |
| `console.timeAsked` | Asked. A supervisor will confirm the times. | कह दिया गया। सुपरवाइज़र समय पक्का करेगा। |
| `console.lateWaiting` | This late entry waits for approval. | यह देर से भरी एंट्री मंज़ूरी का इंतज़ार कर रही है। |
| `console.lateBadge` | Entered late | देर से भरा |
| `console.people` | People | लोग |
| `console.since` | Since {time} | {time} से |
| `console.shiftLine` | {shift} shift, {day} | {shift} शिफ़्ट, {day} |
| `console.castLabel` | Cast {number} | Cast {number} |
| `console.dieNone` | Die not issued | Die जारी नहीं हुई |
| `console.released` | Released | भेजा गया |
| `console.pressedSoFar` | Pressed so far | अब तक प्रेस हुआ |
| `console.orders` | Orders | ऑर्डर |
| `console.totalLine` | Total {pcs} pcs, {kg} kg | कुल {pcs} पीस, {kg} kg |
| `console.loadFailed` | This run did not load. Check the connection and try again. | यह रन नहीं खुला। कनेक्शन जाँचकर फिर कोशिश करें। |
| `console.notFound` | That run does not exist. | ऐसा कोई रन नहीं है। |
| `console.busy` | Another run is running on this press. Stop it first. | इस प्रेस पर दूसरा रन चल रहा है। पहले उसे रोकें। |
| `console.stoppedBannerChip` | Stopped | रुका हुआ |
| `console.startFailed` | The run did not start. | रन शुरू नहीं हुआ। |
| `console.outbox.notesNeedConnection` | Offline, the remarks and the die reading cannot be saved. Clear them or wait for the connection, then log the run. | ऑफ़लाइन में रिमार्क और डाई रीडिंग सेव नहीं हो सकते। उन्हें हटाएँ या कनेक्शन का इंतज़ार करें, फिर रन लॉग करें। |
| `console.outbox.offline` | Offline: {count} {count:change\|changes} waiting | ऑफ़लाइन: {count} बदलाव बाकी |
| `console.outbox.waiting` | {count} {count:change\|changes} waiting to send | {count} बदलाव भेजने बाकी |
| `console.outbox.sending` | Sending {count} {count:change\|changes} | {count} बदलाव भेज रहे हैं |
| `console.outbox.sendNow` | Send now | अभी भेजें |
| `console.outbox.keepOpen` | Saved on this tablet. They go to orrn in order when the connection is back. Keep this page open. | इस टैबलेट पर सेव है। कनेक्शन आते ही क्रम से orrn पर जाएँगे। यह पेज खुला रखें। |
| `console.outbox.queued` | Offline. Saved on this tablet; it goes when the connection is back. | ऑफ़लाइन। इस टैबलेट पर सेव है; कनेक्शन आते ही जाएगा। |
| `console.outbox.signOutLeft` | {count} {count:change\|changes} not sent yet. They stay saved on this tablet for you and go out when you sign in again. | {count} बदलाव अभी भेजे नहीं गए। वे इस टैबलेट पर आपके लिए सेव रहेंगे और दोबारा साइन इन करने पर जाएँगे। |
| `console.outbox.plantLeft` | {count} {count:change\|changes} not sent yet. They stay saved on this tablet and go out when you are back in this plant. | {count} बदलाव अभी भेजे नहीं गए। वे इस टैबलेट पर सेव रहेंगे और इस प्लांट में लौटने पर जाएँगे। |
| `console.outbox.behind` | Waiting behind a refused change. Saved on this tablet. | जिस बदलाव को orrn ने नहीं लिया, उसके पीछे इंतज़ार में। इस टैबलेट पर सेव है। |
| `console.outbox.blocked` | Waiting behind a refused change ({count} {count:change\|changes}) | जिस बदलाव को orrn ने नहीं लिया, उसके पीछे इंतज़ार में ({count} बदलाव) |
| `console.outbox.sent` | {count} {count:change\|changes} sent | {count} बदलाव भेजे गए |
| `console.outbox.conflicts` | Changes orrn did not take | जो बदलाव orrn ने नहीं लिए |
| `console.outbox.notTaken` | {what} on {run} was not taken | {run} पर {what} नहीं लिया गया |
| `console.outbox.drop` | Remove from the list | सूची से हटाएँ |
| `console.outbox.kind.start` | Start | शुरू |
| `console.outbox.kind.stop` | Stop | रोकें |
| `console.outbox.kind.count` | Count | गिनती |
| `console.outbox.kind.resume` | Resume | फिर चालू |
| `console.outbox.kind.undoStart` | Undo start | शुरू वापस |
| `console.outbox.kind.billets` | Billets | बिलेट |
| `console.outbox.kind.lines` | Pieces and kg | पीस और kg |
| `console.outbox.kind.scrap` | Butt and ends | बट और एंड |
| `console.outbox.kind.qc` | Rejects | रिजेक्ट |
| `console.outbox.kind.close` | Log run | रन लॉग |
| `console.stopFailed` | The run did not stop. | रन रुका नहीं। |
| `console.sections` | Sections | सेक्शन |
| `console.dieCopy` | Die copy | Die कॉपी |
| `console.onTrial` | Die trial | Die ट्रायल |
| `console.trialNeeded` | Say whether the die trial passed or failed. | बताएँ कि die ट्रायल पास हुआ या फेल। |
| `console.next` | Next | आगे |
| `console.back` | Back | पीछे |
| `board.subtitle` | Every press: what is running and what waits. | हर प्रेस: क्या चल रहा है और क्या इंतज़ार में है। |
| `board.onLine` | On the line | लाइन पर |
| `board.nothingRunning` | Nothing running | कुछ नहीं चल रहा |
| `board.waiting` | Waiting | इंतज़ार में |
| `board.todayLogged` | Today, logged | आज दर्ज |
| `board.openQueue` | Open the queue | कतार खोलें |
| `board.pressStopped` | Press stopped | प्रेस रुका है |
| `board.noLines` | No press lines yet. | अभी कोई प्रेस लाइन नहीं। |
| `board.noLinesBody` | Add the presses on the Press lines page. | प्रेस लाइन पेज पर प्रेस जोड़ें। |
| `board.manageLines` | Press lines | प्रेस लाइन |
| `board.openStation` | Open the station | स्टेशन खोलें |
| `board.loadFailed` | The press board did not load. Check the connection and try again. | प्रेस बोर्ड नहीं खुला। कनेक्शन जाँचकर फिर कोशिश करें। |
| `queue.title` | {line} queue | {line} की कतार |
| `queue.subtitle` | Jobs for this press, in the order they run. | इस प्रेस के काम, चलने के क्रम में। |
| `queue.onLine` | On the line | लाइन पर |
| `queue.waiting` | Waiting | इंतज़ार में |
| `queue.empty` | Nothing released to this press. | इस प्रेस को कुछ नहीं भेजा गया। |
| `queue.emptyBody` | Plans released from Orders and planning land here. | ऑर्डर और प्लानिंग से भेजे गए प्लान यहाँ आते हैं। |
| `queue.dieCopy` | Die copy | Die कॉपी |
| `queue.dieNotIssued` | Die not issued | Die जारी नहीं हुई |
| `queue.bolster` | Bolster {no} | बोल्स्टर {no} |
| `queue.orders` | Orders | ऑर्डर |
| `queue.released` | Released | भेजा गया |
| `queue.total` | Total | कुल |
| `queue.pressedSoFar` | Pressed so far {kg} kg | अब तक प्रेस हुआ {kg} kg |
| `queue.noOrderLines` | No order line | ऑर्डर लाइन नहीं |
| `queue.purposeNote` | Goes against no order. | किसी ऑर्डर में नहीं जाता। |
| `queue.filterSection` | Section | सेक्शन |
| `queue.filterOrder` | Order | ऑर्डर |
| `queue.filterCopy` | Die copy | Die कॉपी |
| `queue.filterAll` | All | सब |
| `queue.urgent` | Urgent | जल्दी |
| `queue.markUrgent` | Mark urgent | जल्दी का निशान लगाएँ |
| `queue.clearUrgent` | Remove urgent | जल्दी हटाएँ |
| `queue.moveFailed` | The queue did not change. Reload and try again. | कतार नहीं बदली। फिर लोड करके कोशिश करें। |
| `queue.pullBackTitle` | Take this length back to planning? | यह लंबाई प्लानिंग में वापस लें? |
| `queue.pullBackBody` | {order}, {length}, {pcs} pcs, {kg} kg become planable again. The run keeps its other lengths. | {order}, {length}, {pcs} पीस, {kg} kg फिर से प्लान हो सकेंगे। रन की बाकी लंबाइयाँ रहेंगी। |
| `queue.pullBackReason` | Why (optional) | क्यों (वैकल्पिक) |
| `queue.pullBackConfirm` | Take back | वापस लें |
| `queue.pullBackFailed` | Could not take it back. | वापस नहीं ले सके। |
| `queue.lateEntry` | Late entry | देर से एंट्री |
| `queue.loadFailed` | The queue did not load. Check the connection and try again. | कतार नहीं खुली। कनेक्शन जाँचकर फिर कोशिश करें। |
| `queue.noMatch` | No job matches these filters. | इन फ़िल्टर से कोई काम नहीं मिला। |
| `late.title` | Run entered late | देर से भरा रन |
| `late.body` | For a run that already stopped and was never entered on the tablet. A manager approves it before it can be logged. | ऐसे रन के लिए जो रुक चुका है और टैबलेट पर नहीं भरा गया। दर्ज होने से पहले मैनेजर मंज़ूर करता है। |
| `late.window` | Only a run from the last {days} days can be entered late. Older runs are not accepted. | सिर्फ़ पिछले {days} दिनों का रन देर से भरा जा सकता है। इससे पुराने रन स्वीकार नहीं होते। |
| `late.tooOld` | The start is more than {days} days ago. A late entry must be from the last {days} days. | शुरू का समय {days} दिन से ज़्यादा पुराना है। देर से भरी एंट्री पिछले {days} दिनों की ही हो सकती है। |
| `late.line` | Press | प्रेस |
| `late.source` | Which run | कौन सा रन |
| `late.fromQueue` | A run from the queue | कतार का रन |
| `late.notInQueue` | A run not in the queue | कतार से बाहर का रन |
| `late.pickRun` | Queued run | कतार का रन |
| `late.pickCopy` | Die copy | Die कॉपी |
| `late.startedAt` | Started | शुरू |
| `late.stoppedAt` | Stopped | बंद |
| `late.operator` | Operator | ऑपरेटर |
| `late.relief` | Relief operator | रिलीफ ऑपरेटर |
| `late.reason` | Why it is entered late | देर से क्यों भरा |
| `late.submit` | Enter the run | रन भरें |
| `late.done` | {number} entered. It waits for approval. | {number} भर गया। मंज़ूरी का इंतज़ार है। |
| `late.order` | Stop must be after start. | बंद का समय शुरू के बाद होना चाहिए। |
| `late.futureStop` | A late entry is for a run that has already stopped. | देर से एंट्री उस रन की है जो रुक चुका है। |
| `late.noQueued` | No queued run on this press. | इस प्रेस पर कतार में कोई रन नहीं। |
| `late.pickOne` | Pick one | एक चुनें |
| `late.needCopy` | Pick the die copy that was used. | जो Die कॉपी लगी थी, वह चुनें। |
| `late.findCopy` | Type the copy code | कॉपी कोड लिखें |
| `late.copyIssued` | Die copy {code} is issued to this run. | Die कॉपी {code} इस रन को दी गई है। |
| `late.copyHint` | Copies of {section} on the rack. | {section} की रैक पर रखी कॉपी। |
| `late.copyHintTrial` | Copies of {section} on the rack or on trial (a die trial run). | {section} की रैक पर रखी या ट्रायल वाली कॉपी (die ट्रायल रन)। |
| `linesPage.title` | Press lines | प्रेस लाइन |
| `linesPage.subtitle` | The presses of the plant. | प्लांट के प्रेस। |
| `linesPage.empty` | No press lines yet. | अभी कोई प्रेस लाइन नहीं। |
| `linesPage.emptyBody` | Add the first press. | पहला प्रेस जोड़ें। |
| `linesPage.edit` | Edit | बदलें |
| `linesPage.restore` | Restore | फिर चालू करें |
| `linesPage.retired` | Retired | बंद |
| `linesPage.active` | Active | चालू |
| `linesPage.showRetired` | Show retired | बंद वाले दिखाएँ |
| `linesPage.codeHint` | A short code for the press | प्रेस का छोटा कोड |
| `linesPage.tonnageHint` | Optional | वैकल्पिक |
| `linesPage.saved` | Saved. | सेव हो गया। |
| `linesPage.retireConfirmTitle` | Retire {code}? | {code} बंद करें? |
| `linesPage.retireConfirmBody` | It stays in old reports. A press with an open run cannot be retired. | पुरानी रिपोर्ट में यह रहेगा। खुले रन वाला प्रेस बंद नहीं होता। |
| `linesPage.back` | Press | प्रेस |
| `report.title` | Press report | प्रेस रिपोर्ट |
| `report.runNo` | Run no | रन नंबर |
| `report.productionDay` | Production day | उत्पादन दिन |
| `report.shift` | Shift | शिफ्ट |
| `report.line` | Press line | प्रेस लाइन |
| `report.operator` | Operator | ऑपरेटर |
| `report.section` | Section | सेक्शन |
| `report.copy` | Die copy | Die कॉपी |
| `report.orders` | Orders | ऑर्डर |
| `report.cutLengths` | Cut lengths | कट लंबाई |
| `report.cast` | Cast | Cast |
| `report.billets` | Billets | बिलेट |
| `report.startedStopped` | Started to stopped | शुरू से बंद तक |
| `report.runningMin` | Running min | चलने के मिनट |
| `report.downtimeMin` | Downtime min | रुकावट के मिनट |
| `report.good` | Good kg and pcs | अच्छा kg और पीस |
| `report.scrap` | Butt, ends and rejects kg | बट, एंड और रिजेक्ट kg |
| `report.recovery` | Recovery % | रिकवरी % |
| `report.csv` | Download CSV | CSV डाउनलोड करें |
| `report.empty` | No logged runs in this period. | इस समय में कोई रन दर्ज नहीं। |
| `report.lateShare` | Entered late: {pct}% | बाद में भरे: {pct}% |
| `report.trial` | Trial | ट्रायल |
| `report.subtitle` | Logged runs by production day. | उत्पादन दिन के हिसाब से दर्ज रन। |
| `report.from` | From | से |
| `report.to` | To | तक |
| `report.shiftFilter` | Shift | शिफ़्ट |
| `report.lineFilter` | Press line | प्रेस लाइन |
| `report.planFilter` | Plan | प्लान |
| `report.allShifts` | All shifts | सभी शिफ़्ट |
| `report.allLines` | All presses | सभी प्रेस |
| `report.allPlans` | All plans | सभी प्लान |
| `report.planOption` | {number} | {number} |
| `report.totals` | Totals | कुल |
| `report.runsCount` | {count} {count:run\|runs} | {count} रन |
| `report.more` | More runs than shown. Narrow the period. | दिखाए गए से ज़्यादा रन हैं। अवधि छोटी करें। |
| `report.lateShareTitle` | Entered late, by shift and operator | देर से भरे, शिफ़्ट और ऑपरेटर के हिसाब से |
| `report.lateShareRow` | {late} of {runs} runs entered late ({pct}%) | {runs} में से {late} रन देर से भरे ({pct}%) |
| `report.noOperator` | No operator | ऑपरेटर नहीं |
| `report.loadFailed` | The report did not load. Check the connection and try again. | रिपोर्ट नहीं खुली। कनेक्शन जाँचकर फिर कोशिश करें। |
| `report.downloadFailed` | The file could not be made. Try again. | फ़ाइल नहीं बन सकी। फिर कोशिश करें। |
| `report.late` | Late | देर से |
| `report.openRun` | Open run {number} | रन {number} खोलें |
| `report.csvName` | press-report | press-report |
| `alerts.title` | Press alerts | प्रेस अलर्ट |
| `alerts.subtitle` | Readings that went outside the limits set for a press. Check the press, then acknowledge the alert. | प्रेस के लिए तय सीमा से बाहर गए रीडिंग। प्रेस देखें, फिर अलर्ट को देख लिया चिह्नित करें। |
| `alerts.show` | Show | दिखाएं |
| `alerts.showOpen` | Open | खुले |
| `alerts.showAll` | All | सब |
| `alerts.empty` | No alerts yet. | अभी कोई अलर्ट नहीं। |
| `alerts.emptyOpen` | No open alerts. | कोई अलर्ट खुला नहीं। |
| `alerts.loadFailed` | The alerts did not load. Check the connection and try again. | अलर्ट नहीं आए। कनेक्शन देखकर फिर कोशिश करें। |
| `alerts.columns.line` | Press | प्रेस |
| `alerts.columns.metric` | Reading | रीडिंग |
| `alerts.columns.limit` | Limit | सीमा |
| `alerts.columns.peak` | Worst | सबसे ज़्यादा |
| `alerts.columns.started` | Started | शुरू |
| `alerts.columns.last` | Last reading | आखिरी रीडिंग |
| `alerts.columns.status` | Status | स्थिति |
| `alerts.columns.run` | Run | रन |
| `alerts.metric.ram_speed` | Ram speed | राम की रफ़्तार |
| `alerts.metric.billet_temp` | Billet temperature | बिलेट का तापमान |
| `alerts.metric.exit_temp` | Exit temperature | बाहर निकलते समय तापमान |
| `alerts.metric.container_temp` | Container temperature | कंटेनर का तापमान |
| `alerts.metric.pressure` | Pressure | दबाव |
| `alerts.unit.ram_speed` | mm/s | mm/s |
| `alerts.unit.billet_temp` | °C | °C |
| `alerts.unit.exit_temp` | °C | °C |
| `alerts.unit.container_temp` | °C | °C |
| `alerts.unit.pressure` | bar | bar |
| `alerts.low` | Below {limit} {unit} | {limit} {unit} से कम |
| `alerts.high` | Above {limit} {unit} | {limit} {unit} से ज़्यादा |
| `alerts.status.open` | Open | खुला |
| `alerts.status.ended` | Ended | खत्म |
| `alerts.status.acknowledged` | Acknowledged | देख लिया |
| `alerts.simulated` | From the simulator | सिमुलेटर से |
| `alerts.frames` | {count} {count:reading\|readings} | {count} {count:रीडिंग\|रीडिंग} |
| `alerts.acknowledge` | Acknowledge | देख लिया |
| `alerts.acknowledged` | Alert acknowledged | अलर्ट देख लिया गया |
| `alerts.ackFailed` | Could not acknowledge. Try again. | चिह्नित नहीं हुआ। फिर कोशिश करें। |
| `alerts.ackedAt` | Acknowledged {time} | {time} पर देखा गया |
| `summary.title` | Daily press summary | रोज़ का प्रेस सारांश |
| `summary.pressedToday` | Pressed today | आज प्रेस हुआ |
| `summary.recovery` | Recovery | रिकवरी |
| `summary.downtime` | Downtime | रुकावट |
| `summary.byLine` | By press | प्रेस के हिसाब से |
| `summary.noRuns` | No runs logged today. | आज कोई रन दर्ज नहीं। |
| `summary.kg` | {kg} kg | {kg} kg |
| `summary.minutes` | {min} min | {min} मिनट |
| `summary.day` | Production day | उत्पादन दिन |
| `summary.dayHint` | The production day opens with the first shift, not at midnight. | उत्पादन दिन पहली शिफ़्ट से खुलता है, आधी रात से नहीं। |
| `summary.runs` | Runs | रन |
| `summary.pieces` | Pieces | पीस |
| `summary.scrap` | Butt, ends and rejects | बट, एंड और रिजेक्ट |
| `summary.stops` | Stops, longest first | स्टॉपेज, सबसे लंबे पहले |
| `summary.stopsNone` | No stops today. | आज कोई स्टॉपेज नहीं। |
| `summary.shifts` | By shift | शिफ़्ट के हिसाब से |
| `summary.late` | Entered late | देर से भरे |
| `summary.lateShare` | {pct}% of runs | {pct}% रन |
| `summary.open` | Open the press summary | प्रेस सारांश खोलें |
| `summary.report` | Open the press report | प्रेस रिपोर्ट खोलें |
| `summary.previous` | Earlier day | पिछला दिन |
| `summary.loadFailed` | The summary did not load. Check the connection and try again. | सारांश नहीं खुला। कनेक्शन जाँचकर फिर कोशिश करें। |
| `summary.shiftRow` | {runs} {runs:run\|runs}, {kg} kg | {runs} रन, {kg} kg |
| `summary.trials` | trials {kg} kg | ट्रायल {kg} kg |

### foundry (548)

| Key | English | हिंदी |
|---|---|---|
| `refusal.notFound` | Not found. Refresh the list and try again. | नहीं मिला। सूची रीफ़्रेश करके फिर कोशिश करें। |
| `refusal.streamExists` | A return stream with that code or name already exists. | इस कोड या नाम की रिटर्न स्ट्रीम पहले से है। |
| `refusal.giveName` | Give a name. | नाम लिखें। |
| `refusal.pickAlloy` | Pick the alloy. | अलॉय चुनें। |
| `refusal.alloyRetired` | Alloy {code} is retired. | अलॉय {code} बंद है। |
| `refusal.alloyMismatch` | Alloy {code} is not {other}. | अलॉय {code}, {other} नहीं है। |
| `refusal.castClosed` | Cast {cast} is closed. | कास्ट {cast} बंद हो चुका है। |
| `refusal.castWaiting` | Cast {cast} is waiting for its close-out approval. | कास्ट {cast} क्लोज़-आउट की मंज़ूरी का इंतज़ार कर रहा है। |
| `refusal.castChanged` | Cast {cast} changed. Open it again. | कास्ट {cast} बदल गया। उसे फिर खोलें। |
| `refusal.castDraft` | Cast {cast} has a melt that is not locked. Lock it or discard it first. | कास्ट {cast} में एक मेल्ट लॉक नहीं है। पहले उसे लॉक करें या हटाएँ। |
| `refusal.castShort` | The press used {kg} kg more billets of {cast} than the store held. Pick a reason. | प्रेस ने {cast} के स्टोर से {kg} kg ज़्यादा बिलेट लिए। कारण चुनें। |
| `refusal.castTail` | {kg} kg of {cast} billets is not explained. Pick a reason. | {cast} के {kg} kg बिलेट का हिसाब नहीं मिलता। कारण चुनें। |
| `refusal.castClosing` | Cast {cast} changed while you were closing it. Check the close-out again. | बंद करते समय कास्ट {cast} बदल गया। क्लोज़-आउट फिर देखें। |
| `refusal.castHasMelts` | Cast {cast} has melts. Cancel or discard them first. | कास्ट {cast} में मेल्ट हैं। पहले उन्हें रद्द करें या हटाएँ। |
| `refusal.tailReason` | Pick why the billets do not add up. | बिलेट का हिसाब क्यों नहीं मिलता, कारण चुनें। |
| `refusal.noteNeeded` | Write what happened in the note. | नोट में लिखें क्या हुआ। |
| `refusal.timesOrder` | The melt times are out of order. Check them. | मेल्ट के समय क्रम में नहीं हैं। जाँचें। |
| `refusal.future` | That time is in the future. Check the date and time. | यह समय आगे का है। तारीख और समय जाँचें। |
| `refusal.span` | Check the times: the melt runs over 3 days. | समय जाँचें: मेल्ट 3 दिन से लंबा है। |
| `refusal.preheatEarly` | The preheat start is more than 7 days before cast {cast} was opened. Check the date. | प्रीहीट शुरू, कास्ट {cast} खुलने से 7 दिन से ज़्यादा पहले है। तारीख जाँचें। |
| `refusal.castAlloyOther` | Cast {cast} is alloy {alloy}. Open a new cast for {other}. | कास्ट {cast} अलॉय {alloy} का है। {other} के लिए नया कास्ट खोलें। |
| `refusal.lotNotInStock` | {lot} is not in scrap stock. | {lot} स्क्रैप स्टॉक में नहीं है। |
| `refusal.lotLeft` | Only {kg} kg left in {lot}. | {lot} में सिर्फ़ {kg} kg बचा है। |
| `refusal.lineTwice` | A line is listed twice. Put its kg on one line. | एक लाइन दो बार है। उसका kg एक लाइन में लिखें। |
| `refusal.storeRetired` | {name} is retired in the store. Turn it back on first: cancelling the melt returns it. | {name} स्टोर में बंद है। पहले उसे चालू करें: मेल्ट रद्द करने पर वह वापस आता है। |
| `refusal.storeLocRetired` | {place} is retired. Turn it back on first: cancelling the melt returns {name} there. | {place} बंद है। पहले उसे चालू करें: मेल्ट रद्द करने पर {name} वहाँ लौटता है। |
| `refusal.byproduct` | {name} is a by-product. It is not charged or returned as metal. | {name} बाय-प्रोडक्ट है। इसे धातु की तरह चार्ज या वापस नहीं किया जाता। |
| `refusal.namedRetired` | {name} is retired. | {name} बंद है। |
| `refusal.logsTogether` | Logs need pieces, length and kg together. | लॉग के लिए नग, लंबाई और kg तीनों लिखें। |
| `refusal.chemClose` | For each chemical, close must be open minus used. | हर केमिकल में, बंद = खुला − इस्तेमाल। |
| `refusal.storeQty` | A store item needs the quantity used. | स्टोर आइटम की इस्तेमाल मात्रा लिखें। |
| `refusal.storeTwice` | A store item is listed twice. | एक स्टोर आइटम दो बार है। |
| `refusal.chemName` | Name the chemical, or pick it from the store. | केमिकल का नाम लिखें, या स्टोर से चुनें। |
| `refusal.tryAgain` | Something changed while saving. Try again. | सेव करते समय कुछ बदल गया। फिर कोशिश करें। |
| `refusal.meltCancelled` | This melt is cancelled. | यह मेल्ट रद्द है। |
| `refusal.discardInstead` | This melt is not locked. Discard the draft instead. | यह मेल्ट लॉक नहीं है। इसके बजाय ड्राफ़्ट हटाएँ। |
| `refusal.billetsUsed` | The press has already used billets of {cast}. This melt can no longer be changed. | प्रेस {cast} के बिलेट इस्तेमाल कर चुका है। यह मेल्ट अब बदला नहीं जा सकता। |
| `refusal.meltChanged` | This melt changed. Open it again. | यह मेल्ट बदल गया। उसे फिर खोलें। |
| `refusal.base64` | The file could not be read. Attach it again. | फ़ाइल पढ़ी नहीं जा सकी। फिर से जोड़ें। |
| `refusal.fileSize` | The file is larger than 1 MB. | फ़ाइल 1 MB से बड़ी है। |
| `refusal.maxValues` | At most {max} values. | ज़्यादा से ज़्यादा {max} मान। |
| `refusal.fileOrValues` | Attach the file or enter the values. | फ़ाइल जोड़ें या मान लिखें। |
| `refusal.oneElement` | Enter at least one element. | कम से कम एक तत्व लिखें। |
| `refusal.resultVoid` | This result is already void. | यह नतीजा पहले से रद्द है। |
| `refusal.spectroLocked` | The melt is locked. Its spectro stays as it is. | मेल्ट लॉक है। उसका स्पेक्ट्रो वैसा ही रहेगा। |
| `refusal.elementTwice` | An element is listed twice. | एक तत्व दो बार है। |
| `refusal.minAboveMax` | A minimum is above its maximum. | न्यूनतम उसकी अधिकतम सीमा से ज़्यादा है। |
| `refusal.requestReused` | This request was already used for something else. Refresh and try again. | यह अनुरोध पहले किसी और काम में लगा। रीफ़्रेश करके फिर कोशिश करें। |
| `refusal.otherCast` | This melt belongs to another cast. | यह मेल्ट किसी दूसरे कास्ट का है। |
| `refusal.lockedAsk` | This melt is locked. Ask for a correction to change it. | यह मेल्ट लॉक है। बदलने के लिए सुधार माँगें। |
| `refusal.notDraft` | Only a draft melt can be changed or discarded. | सिर्फ़ ड्राफ़्ट मेल्ट बदला या हटाया जा सकता है। |
| `refusal.onlyLocked` | Only a locked melt can be corrected. | सिर्फ़ लॉक किया मेल्ट सुधारा जा सकता है। |
| `refusal.pickWrong` | Pick what is wrong with the melt. | मेल्ट में क्या गलत है, चुनें। |
| `refusal.askFirst` | Ask for a correction first. An approver has to agree. | पहले सुधार माँगें। मंज़ूरी देने वाले की हाँ ज़रूरी है। |
| `refusal.correctionWaiting` | A correction for this melt is already waiting for approval. | इस मेल्ट का सुधार पहले से मंज़ूरी का इंतज़ार कर रहा है। |
| `refusal.correctionApproved` | A correction for this melt is approved. Correct it now. | इस मेल्ट का सुधार मंज़ूर है। अब सुधारें। |
| `refusal.giveBundle` | Scan or type the bundle. | बंडल स्कैन करें या लिखें। |
| `refusal.simulatorOff` | The furnace simulator is off. | फ़र्नेस सिम्युलेटर बंद है। |
| `refusal.dayOrder` | The end day is before the start day. | आख़िरी दिन शुरू के दिन से पहले है। |
| `refusal.maxDays` | Pick at most 92 days. | ज़्यादा से ज़्यादा 92 दिन चुनें। |
| `refusal.addStream` | Add the dross and Fe return streams first in Masters, Return streams. | पहले ड्रॉस और Fe रिटर्न स्ट्रीम जोड़ें (मास्टर्स में, रिटर्न स्ट्रीम)। |
| `refusal.streamReactivate` | Return stream {code} is retired. Turn it back on first in Masters, Return streams. | रिटर्न स्ट्रीम {code} बंद है। पहले उसे चालू करें (मास्टर्स में, रिटर्न स्ट्रीम)। |
| `refusal.streamByproduct` | Return stream {code} must be a by-product stream to take dross or Fe. | ड्रॉस या Fe लेने के लिए रिटर्न स्ट्रीम {code} बाय-प्रोडक्ट होनी चाहिए। |
| `refusal.alreadyLocked` | This melt is already locked. | यह मेल्ट पहले से लॉक है। |
| `refusal.addInput` | Add what went into the furnace. | फ़र्नेस में क्या डाला, जोड़ें। |
| `refusal.addLogs` | Add the logs that came out. | जो लॉग निकले, जोड़ें। |
| `refusal.chargingStart` | Write the charging start time. | चार्जिंग शुरू का समय लिखें। |
| `refusal.castingEnd` | Write the casting end time, after the charging start. | कास्टिंग खत्म का समय लिखें, चार्जिंग शुरू के बाद का। |
| `refusal.overCapacity` | More metal than the furnace holds. Check the kg. | फ़र्नेस की क्षमता से ज़्यादा धातु। kg जाँचें। |
| `refusal.balanceReason` | The kg in and out do not match. Write why in the balance note. | अंदर और बाहर का kg नहीं मिलता। बैलेंस नोट में कारण लिखें। |
| `refusal.spectroReason` | Spectro has not passed. Write why the melt is locked anyway. | स्पेक्ट्रो पास नहीं हुआ। फिर भी लॉक करने का कारण लिखें। |
| `refusal.alloyReason` | This melt's alloy differs from the cast's. Write why. | इस मेल्ट का अलॉय कास्ट से अलग है। कारण लिखें। |
| `refusal.lineTooLarge` | A line is above 100 t. Check the kg. | एक लाइन 100 t से ऊपर है। kg जाँचें। |
| `refusal.spectroOver` | The eight elements add up to more than 100 %. Check the values. | आठों तत्व मिलकर 100 % से ज़्यादा हैं। मान जाँचें। |
| `refusal.spectroPpm` | Spectro values must be whole ppm from 0 to 1,000,000. | स्पेक्ट्रो मान 0 से 1,000,000 तक पूरे ppm में लिखें। |
| `refusal.castCountOver` | The count finds {kg} kg more billets of {cast} than the ledger. Pick a reason. | गिनती में {cast} के बिलेट लेजर से {kg} kg ज़्यादा मिले। कारण चुनें। |
| `refusal.countWithKg` | Count the billets and weigh them together. | बिलेट गिनें और साथ में तौलें। |
| `refusal.streamShort` | Only {kg} kg of {stream} is in stock. | {stream} में सिर्फ़ {kg} kg स्टॉक में है। |
| `refusal.spectroNoFile` | No file is attached. Write why the numbers are typed. | कोई फ़ाइल नहीं जोड़ी। लिखें कि आंकड़े हाथ से क्यों लिखे। |
| `inbox.columns.file` | File | फ़ाइल |
| `inbox.columns.when` | When | कब |
| `inbox.columns.status` | Status | स्थिति |
| `inbox.title` | Spectro inbox | स्पेक्ट्रो इनबॉक्स |
| `inbox.subtitle` | Result files the spectrometer computer sent. Nothing is attached by itself: pick the melt each file belongs to. | स्पेक्ट्रोमीटर कंप्यूटर से आई नतीजों की फ़ाइलें। कुछ अपने आप नहीं जुड़ता: हर फ़ाइल के लिए मेल्ट खुद चुनें। |
| `inbox.tabs.label` | Files | फ़ाइलें |
| `inbox.tabs.waiting` | Waiting | इंतज़ार में |
| `inbox.tabs.arriving` | Arriving | आ रही हैं |
| `inbox.tabs.handled` | Handled | निपटी |
| `inbox.empty` | No files waiting. | कोई फ़ाइल इंतज़ार में नहीं। |
| `inbox.emptyArriving` | Nothing is arriving. | कुछ भी आ नहीं रहा। |
| `inbox.emptyHandled` | No handled files yet. | अभी कोई फ़ाइल निपटी नहीं। |
| `inbox.loadFailed` | The files did not load. Check the connection and try again. | फ़ाइलें नहीं आईं। कनेक्शन देखकर फिर कोशिश करें। |
| `inbox.size` | {kb} kB | {kb} kB |
| `inbox.captured` | Captured {time} | {time} पर ली गई |
| `inbox.sample` | Sample {ref} | सैंपल {ref} |
| `inbox.instrument` | Instrument {name} | मशीन {name} |
| `inbox.uploaded` | Received {time} | {time} पर मिली |
| `inbox.simulated` | Simulated | सिमुलेटर |
| `inbox.simulatedHint` | Demo data from the simulator. It can only be dismissed. | सिमुलेटर का डेमो डेटा। इसे सिर्फ़ हटाया जा सकता है। |
| `inbox.status.uploading` | Arriving | आ रही है |
| `inbox.status.pending_review` | Waiting | इंतज़ार में |
| `inbox.status.attached` | Attached | जुड़ी |
| `inbox.status.dismissed` | Dismissed | हटाई |
| `inbox.attach` | Attach to a melt | मेल्ट से जोड़ें |
| `inbox.dismiss` | Dismiss | हटाएं |
| `inbox.attachSheet.title` | Attach {file} | {file} जोड़ें |
| `inbox.attachSheet.cast` | Cast | कास्ट |
| `inbox.attachSheet.castPick` | Pick a cast | कास्ट चुनें |
| `inbox.attachSheet.moreCasts` | Show older casts | पुरानी कास्ट दिखाएँ |
| `inbox.attachSheet.melt` | Melt | मेल्ट |
| `inbox.attachSheet.meltPick` | Pick a melt | मेल्ट चुनें |
| `inbox.attachSheet.meltLabel` | Melt {seq} | मेल्ट {seq} |
| `inbox.attachSheet.noMelts` | This cast has no melts yet. | इस कास्ट में अभी कोई मेल्ट नहीं। |
| `inbox.attachSheet.confirm` | Attach file | फ़ाइल जोड़ें |
| `inbox.attachSheet.attached` | File attached to melt {seq} of cast {cast} | फ़ाइल कास्ट {cast} की मेल्ट {seq} से जुड़ गई |
| `inbox.attachSheet.values` | Values read from the file (ppm) | फ़ाइल से पढ़े गए मान (ppm) |
| `inbox.dismissSheet.title` | Dismiss {file} | {file} हटाएं |
| `inbox.dismissSheet.reason` | Why is this file not needed? | यह फ़ाइल क्यों नहीं चाहिए? |
| `inbox.dismissSheet.reasonRequired` | Give a reason. | कारण लिखें। |
| `inbox.dismissSheet.confirm` | Dismiss file | फ़ाइल हटाएं |
| `inbox.dismissSheet.dismissed` | File dismissed | फ़ाइल हटा दी गई |
| `inbox.failed` | Could not save. Check the connection and try again. | सेव नहीं हुआ। कनेक्शन देखकर फिर कोशिश करें। |
| `inbox.handledAt` | Handled {time} | {time} पर निपटी |
| `title` | Foundry | फाउंड्री |
| `common.failed` | Could not save. Check the connection and try again. | सेव नहीं हुआ। कनेक्शन देखकर फिर कोशिश करें। |
| `common.notAllowed` | Your role cannot do this. Ask a supervisor. | आपका रोल यह नहीं कर सकता। सुपरवाइज़र से कहें। |
| `today.title` | Foundry | फाउंड्री |
| `today.open` | Open foundry | फाउंड्री खोलें |
| `today.openCasts` | Open casts | खुली कास्ट |
| `today.openCastsMeta` | Casts still taking melts | जिनमें अभी मेल्ट जुड़ सकती हैं |
| `today.melts` | Melts in progress | चालू मेल्ट |
| `today.meltsMeta` | Drafts not locked yet | ड्राफ़्ट जो अभी लॉक नहीं हुए |
| `today.spectro` | Spectro waiting | स्पेक्ट्रो इंतज़ार में |
| `today.spectroMeta` | Files to attach to a melt | मेल्ट से जोड़ने वाली फ़ाइलें |
| `casts.title` | Casts | कास्ट |
| `casts.subtitle` | Every cast, newest first. A cast is a campaign: several melts under one number. | हर कास्ट, नई पहले। कास्ट एक अभियान है: एक नंबर के नीचे कई मेल्ट। |
| `casts.open` | Open cast | कास्ट खोलें |
| `casts.filter.label` | Status | स्थिति |
| `casts.filter.all` | All | सब |
| `casts.status.open` | Open | खुली |
| `casts.status.closing` | Waiting for approval | मंज़ूरी का इंतज़ार |
| `casts.status.closed` | Closed | बंद |
| `casts.status.cancelled` | Cancelled | रद्द |
| `casts.columns.cast` | Cast | कास्ट |
| `casts.columns.alloy` | Alloy | अलॉय |
| `casts.columns.status` | Status | स्थिति |
| `casts.columns.melts` | Melts | मेल्ट |
| `casts.columns.logs` | Billets made | बने बिलेट |
| `casts.columns.onHand` | On hand | हाथ में |
| `casts.columns.opened` | Opened | खुली |
| `casts.drafts` | {count} {count:draft\|drafts} | {count} ड्राफ़्ट |
| `casts.empty` | No casts yet. | अभी कोई कास्ट नहीं। |
| `casts.emptyHint` | Open the first cast to start a melt. | मेल्ट शुरू करने के लिए पहली कास्ट खोलें। |
| `casts.emptyFiltered` | No cast matches. | कोई कास्ट नहीं मिली। |
| `casts.loadFailed` | The casts did not load. Check the connection and try again. | कास्ट नहीं आईं। कनेक्शन देखकर फिर कोशिश करें। |
| `casts.trace.label` | Find a cast or bundle | कास्ट या बंडल खोजें |
| `casts.trace.placeholder` | k31 or 26J1842 | k31 या 26J1842 |
| `casts.trace.go` | Trace | ट्रेस |
| `casts.trace.notCode` | Type a cast code like k31 or a bundle number like 26J1842. | k31 जैसा कास्ट कोड या 26J1842 जैसा बंडल नंबर लिखें। |
| `casts.trace.bundleFrom` | Bundle {serial} came from cast {number}. | बंडल {serial} कास्ट {number} से आया। |
| `casts.trace.openTrace` | Open the trace | ट्रेस खोलें |
| `casts.trace.noCast` | Bundle {serial} has no cast on it. | बंडल {serial} पर कास्ट नहीं लिखी। |
| `newCast.title` | Open a cast | कास्ट खोलें |
| `newCast.subtitle` | Pick the alloy this cast is for. The number comes from the plant's series. | इस कास्ट का अलॉय चुनें। नंबर प्लांट की सीरीज़ से आता है। |
| `newCast.alloy` | Alloy | अलॉय |
| `newCast.alloyHint` | Melts of this cast aim at this alloy. | इस कास्ट की मेल्ट इसी अलॉय के लिए होंगी। |
| `newCast.alloyPick` | Pick the alloy | अलॉय चुनें |
| `newCast.furnace` | Furnace | फर्नेस |
| `newCast.noAlloy` | No alloy is set up yet. | अभी कोई अलॉय नहीं जुड़ा। |
| `newCast.addAlloy` | Add an alloy | अलॉय जोड़ें |
| `newCast.noFurnace` | No furnace is set up yet. | अभी कोई फर्नेस नहीं जुड़ी। |
| `newCast.noFurnaceAsk` | Ask a manager to add the furnace. | मैनेजर से फर्नेस जुड़वाएं। |
| `newCast.addFurnace` | Add a furnace | फर्नेस जोड़ें |
| `newCast.loadFailed` | The alloys did not load. Check the connection and try again. | अलॉय नहीं आए। कनेक्शन देखकर फिर कोशिश करें। |
| `newCast.opened` | Cast {number} is open | कास्ट {number} खुल गई |
| `cast.heading` | Cast {number} | कास्ट {number} |
| `cast.alloyIs` | Alloy {alloy} | अलॉय {alloy} |
| `cast.back` | Cast | कास्ट |
| `cast.certificate` | Test certificate | टेस्ट सर्टिफ़िकेट |
| `cast.notFound` | That cast was not found. | वह कास्ट नहीं मिली। |
| `cast.loadFailed` | The cast did not load. Check the connection and try again. | कास्ट नहीं आई। कनेक्शन देखकर फिर कोशिश करें। |
| `cast.tailChip.balanced` | Every billet accounted for | हर बिलेट का हिसाब पूरा |
| `cast.tailChip.tail` | Tail {kg} kg | टेल {kg} kg |
| `cast.tailChip.short` | Billets short {kg} kg | बिलेट कम {kg} kg |
| `cast.tailChip.empty` | No melts yet | अभी कोई मेल्ट नहीं |
| `cast.panel.title` | Billets | बिलेट |
| `cast.panel.produced` | Made | बने |
| `cast.panel.pressed` | Used by the press | प्रेस ने लिए |
| `cast.panel.onHand` | On hand | हाथ में |
| `cast.panel.tail` | Tail | टेल |
| `cast.panel.hint` | Tail is billets made, less what the press used, less what is on hand. | टेल = बने बिलेट, घटा प्रेस ने जो लिए, घटा जो हाथ में हैं। |
| `cast.panel.beside` | Beside the tail | टेल के साथ |
| `cast.panel.metalIn` | Metal in | डाला हुआ मेटल |
| `cast.panel.burn` | Burn | बर्न |
| `cast.panel.bundles` | In bundles | बंडलों में |
| `cast.panel.melts` | Melts | मेल्ट |
| `cast.approval.waiting` | This cast is waiting for a second person to approve the close. No new melt can start. | इस कास्ट का क्लोज़ दूसरे व्यक्ति की मंज़ूरी का इंतज़ार कर रहा है। नई मेल्ट शुरू नहीं होगी। |
| `cast.approval.rejected` | The close was not approved. | क्लोज़ मंज़ूर नहीं हुआ। |
| `cast.tabs.label` | Cast pages | कास्ट के पन्ने |
| `cast.tabs.melts` | Melts | मेल्ट |
| `cast.tabs.trace` | Trace | ट्रेस |
| `cast.melts.title` | Melts | मेल्ट |
| `cast.melts.none` | No melt yet. Start the first melt. | अभी कोई मेल्ट नहीं। पहली मेल्ट शुरू करें। |
| `cast.melts.melt` | Melt | मेल्ट |
| `cast.melts.status` | Status | स्थिति |
| `cast.melts.time` | Charging to casting end | चार्जिंग से कास्टिंग अंत |
| `cast.melts.in` | Metal in | डाला मेटल |
| `cast.melts.logs` | Logs out | निकले लॉग |
| `cast.melts.burn` | Burn | बर्न |
| `cast.melts.spectro` | Spectro | स्पेक्ट्रो |
| `cast.close.button` | Close cast | कास्ट बंद करें |
| `cast.close.title` | Close cast {number} | कास्ट {number} बंद करें |
| `cast.close.confirm` | Close cast | कास्ट बंद करें |
| `cast.close.askButton` | Send for approval | मंज़ूरी के लिए भेजें |
| `cast.close.clean` | The count matches the ledger. Every billet is accounted for. | गिनती खाते से मिलती है। हर बिलेट का हिसाब पूरा है। |
| `cast.close.countTitle` | Count the billets left | बचे हुए बिलेट गिनें |
| `cast.close.countHint` | Count the billets of this cast still in the yard and weigh them. The tail is worked out from your count. | इस कास्ट के जो बिलेट अभी यार्ड में हैं, गिनकर तौलें। टेल आपकी गिनती से निकलती है। |
| `cast.close.pcs` | Billets counted (pieces) | गिने बिलेट (पीस) |
| `cast.close.kg` | Billets counted (kg) | गिने बिलेट (kg) |
| `cast.close.pcsInvalid` | Write the number of billets, 0 if none. | बिलेट की संख्या लिखें, न हों तो 0। |
| `cast.close.kgInvalid` | Write the weight in kg, 0 if none. | वज़न kg में लिखें, न हो तो 0। |
| `cast.close.together` | Pieces and kg go together: both zero or both above zero. | पीस और kg साथ चलते हैं: दोनों शून्य या दोनों शून्य से ऊपर। |
| `cast.close.ledgerOnHand` | On hand by the ledger | खाते के हिसाब से हाथ में |
| `cast.close.counted` | Counted | गिने |
| `cast.close.adjust` | The ledger moves by {kg} kg to match the count | गिनती से मिलाने के लिए खाता {kg} kg हिलेगा |
| `cast.close.adjustNone` | No change to the ledger | खाते में कोई बदलाव नहीं |
| `cast.close.tailIs` | Tail {kg} kg | टेल {kg} kg |
| `cast.close.countOver` | The count finds {kg} kg more billets than the ledger. | गिनती में खाते से {kg} kg बिलेट ज़्यादा निकले। |
| `cast.close.waitingCount` | Write the count to see the tail. | टेल देखने के लिए गिनती लिखें। |
| `cast.close.short` | The press used {kg} kg more billets than the store held. | प्रेस ने स्टोर में जितने थे उससे {kg} kg बिलेट ज़्यादा लिए। |
| `cast.close.needsApproval` | A tail this size needs a second person to approve before the cast closes. | इतनी टेल पर कास्ट बंद करने से पहले दूसरे व्यक्ति की मंज़ूरी चाहिए। |
| `cast.close.reason` | Why the billets do not add up | बिलेट का हिसाब क्यों नहीं मिला |
| `cast.close.reasonPick` | Pick a reason | कारण चुनें |
| `cast.close.reasonRequired` | Pick a reason. | कारण चुनें। |
| `cast.close.note` | Note | टिप्पणी |
| `cast.close.noteRequired` | Write what happened. | क्या हुआ, लिखें। |
| `cast.close.blockedDraft` | Lock or discard the draft melt before closing the cast. | कास्ट बंद करने से पहले ड्राफ़्ट मेल्ट लॉक करें या हटाएं। |
| `cast.close.closed` | Cast {number} is closed | कास्ट {number} बंद हो गई |
| `cast.close.sent` | Close of cast {number} sent for approval | कास्ट {number} का क्लोज़ मंज़ूरी के लिए भेजा गया |
| `cast.cancel.button` | Cancel cast | कास्ट रद्द करें |
| `cast.cancel.title` | Cancel cast {number} | कास्ट {number} रद्द करें |
| `cast.cancel.body` | Only a cast with no melt and no billets can be cancelled. The number is not given back. | सिर्फ़ वही कास्ट रद्द होती है जिसमें न कोई मेल्ट है न बिलेट। नंबर वापस नहीं आता। |
| `cast.cancel.reason` | Why is it cancelled? | रद्द क्यों? |
| `cast.cancel.reasonRequired` | Give a reason. | कारण लिखें। |
| `cast.cancel.confirm` | Cancel cast | कास्ट रद्द करें |
| `cast.cancel.done` | Cast {number} is cancelled | कास्ट {number} रद्द हो गई |
| `cast.trace.loadFailed` | The trace did not load. Check the connection and try again. | ट्रेस नहीं आया। कनेक्शन देखकर फिर कोशिश करें। |
| `cast.trace.lots` | Scrap lots in | आए हुए स्क्रैप लॉट |
| `cast.trace.noLots` | No scrap lot has gone into this cast yet. | इस कास्ट में अभी कोई स्क्रैप लॉट नहीं गया। |
| `cast.trace.melts` | Melts | मेल्ट |
| `cast.trace.inLogs` | in {inKg} kg, logs {logs} kg | डाला {inKg} kg, लॉग {logs} kg |
| `cast.trace.billets` | Billets | बिलेट |
| `cast.trace.billetsLine` | made {produced} kg, used {pressed} kg, on hand {onHand} kg | बने {produced} kg, प्रेस ने लिए {pressed} kg, हाथ में {onHand} kg |
| `cast.trace.runs` | Press runs | प्रेस रन |
| `cast.trace.noRuns` | The press has not used this cast yet. | प्रेस ने इस कास्ट से अभी कुछ नहीं लिया। |
| `cast.trace.bundles` | Bundles | बंडल |
| `cast.trace.noBundles` | No bundle names this cast yet. | अभी किसी बंडल पर यह कास्ट नहीं लिखी। |
| `cast.trace.truncated` | Only the first bundles are listed. | सिर्फ़ शुरू के बंडल दिखाए हैं। |
| `cast.trace.customers` | Customers | ग्राहक |
| `cast.trace.noCustomers` | No bundle of this cast has gone to a customer yet. | इस कास्ट का कोई बंडल अभी ग्राहक को नहीं गया। |
| `cast.cost.title` | Charge cost | चार्ज की लागत |
| `cast.cost.total` | Cost of the scrap charged | डाले गए स्क्रैप की लागत |
| `cast.cost.perKg` | Per kg of billet | बिलेट के प्रति kg |
| `cast.cost.lotsKg` | Scrap lots kg | स्क्रैप लॉट kg |
| `cast.cost.notCosted` | Not costed | लागत नहीं निकली |
| `cast.cost.missingRate` | A lot has no rate, so the cost is not worked out. | किसी लॉट का रेट नहीं है, इसलिए लागत नहीं निकली। |
| `cast.cost.streams` | Metal returned from streams ({kg} kg) carries no rate. | स्ट्रीम से लौटे मेटल ({kg} kg) का कोई रेट नहीं होता। |
| `cast.cost.loadFailed` | The cost did not load. | लागत नहीं आई। |
| `melt.title` | Melt | मेल्ट |
| `melt.new` | New melt | नई मेल्ट |
| `melt.number` | Melt {n} | मेल्ट {n} |
| `melt.titleOf` | Melt {n} of {number} | {number} की मेल्ट {n} |
| `melt.newOf` | New melt of {number} | {number} की नई मेल्ट |
| `melt.draftHint` | A draft posts nothing. Stock moves when you lock the melt. | ड्राफ़्ट कुछ पोस्ट नहीं करता। मेल्ट लॉक करने पर ही स्टॉक हिलता है। |
| `melt.notFound` | That melt was not found. | वह मेल्ट नहीं मिली। |
| `melt.castNotOpen` | Cast {number} is not open, so no new melt can start. | कास्ट {number} खुली नहीं है, इसलिए नई मेल्ट शुरू नहीं होगी। |
| `melt.loadFailed` | The melt did not load. Check the connection and try again. | मेल्ट नहीं आई। कनेक्शन देखकर फिर कोशिश करें। |
| `melt.status.draft` | Draft | ड्राफ़्ट |
| `melt.status.locked` | Locked | लॉक |
| `melt.status.cancelled` | Cancelled | रद्द |
| `melt.status.corrected` | Corrected | सुधारी गई |
| `melt.steps.times` | Furnace and times | फर्नेस और समय |
| `melt.steps.charge` | Charge | चार्ज |
| `melt.steps.chemicals` | Chemicals and LDO | केमिकल और LDO |
| `melt.steps.output` | Logs and dross | लॉग और ड्रॉस |
| `melt.steps.spectro` | Spectro and lock | स्पेक्ट्रो और लॉक |
| `melt.times.preheatStart` | Preheat start | प्रीहीट शुरू |
| `melt.times.chargingStart` | Charging start | चार्जिंग शुरू |
| `melt.times.chargingEnd` | Charging end | चार्जिंग खत्म |
| `melt.times.castingStart` | Casting start | कास्टिंग शुरू |
| `melt.times.castingEnd` | Casting end | कास्टिंग खत्म |
| `melt.furnace` | Furnace | फर्नेस |
| `melt.furnacePick` | Pick the furnace | फर्नेस चुनें |
| `melt.noFurnace` | No furnace is set up. Ask a manager. | कोई फर्नेस नहीं जुड़ी। मैनेजर से कहें। |
| `melt.alloy` | Alloy | अलॉय |
| `melt.alloyAsCast` | Same as the cast ({alloy}) | कास्ट जैसा ({alloy}) |
| `melt.alloyReason` | Why a different alloy? | अलग अलॉय क्यों? |
| `melt.alloyReasonHint` | The cast is {cast}. A melt of another alloy needs a reason. | कास्ट {cast} है। दूसरे अलॉय की मेल्ट के लिए कारण चाहिए। |
| `melt.date` | Melt date | मेल्ट की तारीख |
| `melt.now` | Now | अभी |
| `melt.nextDay` | Next day | अगला दिन |
| `melt.charge.title` | Charge | चार्ज |
| `melt.charge.lots` | Scrap lots | स्क्रैप लॉट |
| `melt.charge.lot` | Lot | लॉट |
| `melt.charge.lotPick` | Pick a lot | लॉट चुनें |
| `melt.charge.noLots` | No lot has kg left to charge. | किसी लॉट में डालने लायक kg नहीं बचा। |
| `melt.charge.kg` | Kg | Kg |
| `melt.charge.left` | {kg} kg left | {kg} kg बचा |
| `melt.charge.over` | More than the {kg} kg left in this lot | इस लॉट में बचे {kg} kg से ज़्यादा |
| `melt.charge.all` | All | सब |
| `melt.charge.addLot` | Add lot | लॉट जोड़ें |
| `melt.charge.streams` | Return streams | रिटर्न स्ट्रीम |
| `melt.charge.stream` | Stream | स्ट्रीम |
| `melt.charge.streamPick` | Pick a stream | स्ट्रीम चुनें |
| `melt.charge.addStream` | Add stream | स्ट्रीम जोड़ें |
| `melt.charge.total` | Charged {kg} kg | चार्ज {kg} kg |
| `melt.charge.overCapacity` | More metal than the furnace holds. | फर्नेस की क्षमता से ज़्यादा मेटल। |
| `melt.charge.nearCapacity` | Near the furnace limit. | फर्नेस की सीमा के पास। |
| `melt.chem.title` | Chemicals from the store | स्टोर से केमिकल |
| `melt.chem.hint` | Each chemical used leaves the store when the melt is locked. Close is open less used. | मेल्ट लॉक होने पर इस्तेमाल हुआ हर केमिकल स्टोर से निकलता है। क्लोज़ = ओपन घटा इस्तेमाल। |
| `melt.chem.item` | Chemical | केमिकल |
| `melt.chem.pick` | Pick from the store | स्टोर से चुनें |
| `melt.chem.other` | Not in the store (type its name) | स्टोर में नहीं (नाम लिखें) |
| `melt.chem.name` | Name | नाम |
| `melt.chem.unit` | Unit | इकाई |
| `melt.chem.open` | Open | ओपन |
| `melt.chem.used` | Used | इस्तेमाल |
| `melt.chem.close` | Close | क्लोज़ |
| `melt.chem.add` | Add chemical | केमिकल जोड़ें |
| `melt.chem.storeItem` | Store item | स्टोर आइटम |
| `melt.chem.line` | open {open}, used {used}, close {close} | ओपन {open}, इस्तेमाल {used}, क्लोज़ {close} |
| `melt.ldo.title` | LDO tank dips | LDO टंकी की डिप |
| `melt.ldo.hint` | Write the tank dip in inches at each point. Inches stay inches. | हर जगह टंकी की डिप इंच में लिखें। इंच इंच ही रहते हैं। |
| `melt.ldo.start` | Start | शुरू |
| `melt.ldo.chargingStart` | Charging start | चार्जिंग शुरू |
| `melt.ldo.chargingEnd` | Charging end | चार्जिंग खत्म |
| `melt.ldo.castingStart` | Casting start | कास्टिंग शुरू |
| `melt.ldo.end` | End | अंत |
| `melt.ldo.used` | LDO used {inches} in | LDO इस्तेमाल {inches} इंच |
| `melt.out.logs` | Logs out | निकले लॉग |
| `melt.out.logsHint` | One line for each length that came out. Weigh the kg. | हर लंबाई की एक लाइन। kg तौलकर लिखें। |
| `melt.out.pcs` | Pieces | पीस |
| `melt.out.length` | Log length | लॉग की लंबाई |
| `melt.out.billetLength` | Billet length | बिलेट की लंबाई |
| `melt.out.billetLengthHint` | Leave empty if the same | वही हो तो खाली छोड़ें |
| `melt.out.kg` | Kg | Kg |
| `melt.out.addLog` | Add log line | लॉग लाइन जोड़ें |
| `melt.out.logLine` | {pcs} pcs, {ft} ft, {kg} kg | {pcs} पीस, {ft} ft, {kg} kg |
| `melt.out.byproducts` | Dross and iron | ड्रॉस और आयरन |
| `melt.out.dross` | Dross | ड्रॉस |
| `melt.out.fe` | Iron (Fe) | आयरन (Fe) |
| `melt.out.returns` | Metal returned to a stream | स्ट्रीम में लौटा मेटल |
| `melt.out.addReturn` | Add return | वापसी जोड़ें |
| `melt.out.balanceNote` | Why the balance is off | हिसाब क्यों नहीं मिला |
| `melt.out.burnHigh` | The burn is above 3 percent. Say why. | बर्न 3 प्रतिशत से ऊपर है। कारण लिखें। |
| `melt.out.moreOut` | More came out than went in. Say why. | डाले से ज़्यादा निकला। कारण लिखें। |
| `melt.balance.in` | In {kg} kg | डाला {kg} kg |
| `melt.balance.out` | Out {kg} kg | निकला {kg} kg |
| `melt.balance.burn` | Burn {kg} kg ({pct}%) | बर्न {kg} kg ({pct}%) |
| `melt.balance.yield` | Yield {pct}% | यील्ड {pct}% |
| `melt.balance.yieldLabel` | Yield | यील्ड |
| `melt.spectroReason` | Why lock without a spectro pass? | स्पेक्ट्रो पास हुए बिना लॉक क्यों? |
| `melt.spectroReasonHint` | The metal is already cast, so a melt can lock without a pass. The reason stays on the melt. | मेटल ढल चुका है, इसलिए बिना पास के भी मेल्ट लॉक हो सकती है। कारण मेल्ट पर रहेगा। |
| `melt.notes` | Notes | टिप्पणी |
| `melt.saveDraft` | Save draft | ड्राफ़्ट सेव करें |
| `melt.saveNext` | Save and next | सेव करें और आगे |
| `melt.draftSaved` | Draft saved | ड्राफ़्ट सेव हुआ |
| `melt.lock` | Lock melt | मेल्ट लॉक करें |
| `melt.locked` | Melt {seq} of {number} is locked | {number} की मेल्ट {seq} लॉक हो गई |
| `melt.gates.title` | Before you can lock | लॉक करने से पहले |
| `melt.gates.ready` | Everything needed is in. You can lock this melt. | सब कुछ भरा है। यह मेल्ट लॉक हो सकती है। |
| `melt.gates.unsaved` | Save the draft to check what still stops the lock. | लॉक में क्या रुकावट है, देखने के लिए ड्राफ़्ट सेव करें। |
| `melt.gates.fix` | Go there | वहाँ जाएं |
| `melt.issue.date` | Write the melt date. | मेल्ट की तारीख लिखें। |
| `melt.issue.time` | A time is not a clock time. Write it like 14:20. | समय घड़ी जैसा नहीं है। 14:20 की तरह लिखें। |
| `melt.issue.kg` | Write the kg as a number. | kg अंक में लिखें। |
| `melt.issue.kgTooLarge` | A line is above 100 t. Check the kg. | एक लाइन 100 टन से ऊपर है। kg जाँचें। |
| `melt.issue.lot` | Pick the lot for this line. | इस लाइन के लिए लॉट चुनें। |
| `melt.issue.stream` | Pick the stream for this line. | इस लाइन के लिए स्ट्रीम चुनें। |
| `melt.issue.duplicateLot` | This lot is on another line. Put its kg on one line. | यह लॉट दूसरी लाइन में है। उसका kg एक लाइन में रखें। |
| `melt.issue.duplicateStream` | This stream is on another line. Put its kg on one line. | यह स्ट्रीम दूसरी लाइन में है। उसका kg एक लाइन में रखें। |
| `melt.issue.chemical` | Write what the chemical is and the open and used quantities. | केमिकल क्या है और ओपन व इस्तेमाल की मात्रा लिखें। |
| `melt.issue.chemicalClose` | Close must be open less used. | क्लोज़ = ओपन घटा इस्तेमाल होना चाहिए। |
| `melt.issue.log` | A log line needs pieces, length and kg. | लॉग लाइन में पीस, लंबाई और kg चाहिए। |
| `melt.issue.ldo` | Write the dip as inches, for example 42.5. | डिप इंच में लिखें, जैसे 42.5। |
| `melt.issue.tooMany` | Too many charge lines. | चार्ज की लाइनें बहुत ज़्यादा हैं। |
| `melt.discard.button` | Discard draft | ड्राफ़्ट हटाएं |
| `melt.discard.title` | Discard this draft? | यह ड्राफ़्ट हटाएं? |
| `melt.discard.body` | Nothing was posted, so nothing is reversed. The draft is gone. | कुछ पोस्ट नहीं हुआ था, इसलिए कुछ पलटना नहीं है। ड्राफ़्ट चला जाएगा। |
| `melt.discard.reason` | Reason (optional) | कारण (ज़रूरी नहीं) |
| `melt.discard.confirm` | Discard draft | ड्राफ़्ट हटाएं |
| `melt.discard.done` | Draft discarded | ड्राफ़्ट हटा दिया |
| `melt.cancelledNote` | This melt is cancelled. Its kg were reversed. | यह मेल्ट रद्द है। इसके kg वापस कर दिए गए। |
| `melt.correctedNote` | This melt was corrected. A newer melt took its place and its kg were reversed. | यह मेल्ट सुधारी गई थी। नई मेल्ट ने इसकी जगह ली और इसके kg वापस कर दिए गए। |
| `melt.correctsNote` | This draft corrects melt {n}. | यह ड्राफ़्ट मेल्ट {n} को सुधारता है। |
| `melt.sheet.figures` | Figures | आँकड़े |
| `melt.sheet.balanceNote` | Balance note: {note} | हिसाब की टिप्पणी: {note} |
| `melt.sheet.alloyReason` | Alloy note: {note} | अलॉय की टिप्पणी: {note} |
| `melt.sheet.spectroReason` | Spectro note: {note} | स्पेक्ट्रो की टिप्पणी: {note} |
| `melt.correction.title` | Correct this melt | इस मेल्ट को सुधारें |
| `melt.correction.body` | A locked melt is not edited. Ask for a correction. When an approver agrees, the melt is reversed and opens again as a draft. | लॉक मेल्ट बदली नहीं जाती। सुधार माँगें। मंज़ूरी देने वाले के हाँ करने पर मेल्ट पलट दी जाती है और ड्राफ़्ट बनकर फिर खुलती है। |
| `melt.correction.ask` | Ask for a correction | सुधार माँगें |
| `melt.correction.askTitle` | Ask to correct this melt | इस मेल्ट का सुधार माँगें |
| `melt.correction.reason` | What is wrong | क्या गलत है |
| `melt.correction.reasonPick` | Pick what is wrong | क्या गलत है, चुनें |
| `melt.correction.reasonRequired` | Pick what is wrong. | क्या गलत है, चुनें। |
| `melt.correction.note` | Note | टिप्पणी |
| `melt.correction.noteRequired` | Write what is wrong. | क्या गलत है, लिखें। |
| `melt.correction.send` | Send request | अनुरोध भेजें |
| `melt.correction.sent` | Correction request sent for approval | सुधार का अनुरोध मंज़ूरी के लिए भेजा गया |
| `melt.correction.pending` | A correction is waiting for approval. | सुधार मंज़ूरी का इंतज़ार कर रहा है। |
| `melt.correction.rejected` | The correction was not approved. | सुधार मंज़ूर नहीं हुआ। |
| `melt.correction.now` | Correct this melt now | अब यह मेल्ट सुधारें |
| `melt.correction.done` | The melt is open again as a draft | मेल्ट ड्राफ़्ट बनकर फिर खुल गई |
| `melt.readings.title` | Furnace readings | फर्नेस रीडिंग |
| `melt.readings.none` | No reading yet. | अभी कोई रीडिंग नहीं। |
| `melt.readings.unit` | C | C |
| `melt.readings.simulate` | Add simulated readings | सिमुलेटेड रीडिंग जोड़ें |
| `spectro.title` | Spectro | स्पेक्ट्रो |
| `spectro.none` | No spectro | स्पेक्ट्रो नहीं |
| `spectro.noneYet` | No spectro result on this melt yet. | इस मेल्ट पर अभी स्पेक्ट्रो नतीजा नहीं। |
| `spectro.verdict.pass` | Pass | पास |
| `spectro.verdict.fail` | Fail | फेल |
| `spectro.verdict.incomplete` | Incomplete | अधूरा |
| `spectro.source.file` | File | फ़ाइल |
| `spectro.source.typed` | Typed | हाथ से लिखा |
| `spectro.source.import` | From the spectro computer | स्पेक्ट्रो कंप्यूटर से |
| `spectro.element` | Element | तत्व |
| `spectro.limit` | Limit | सीमा |
| `spectro.reading` | Reading | रीडिंग |
| `spectro.readingPass` | Inside | अंदर |
| `spectro.readingFail` | Outside | बाहर |
| `spectro.noLimit` | No limit | सीमा नहीं |
| `spectro.alBalance` | balance | बाकी |
| `spectro.max` | max | अधिकतम |
| `spectro.min` | min | न्यूनतम |
| `spectro.to` | to | से |
| `spectro.noTable` | These values cannot be shown against the limits. | ये मान सीमा के साथ नहीं दिखाए जा सकते। |
| `spectro.hint` | Judged against the limits of alloy {alloy}. The numbers are the record; a file is the evidence. | अलॉय {alloy} की सीमा से जाँचा जाता है। लिखे हुए आँकड़े रिकॉर्ड हैं; फ़ाइल सबूत है। |
| `spectro.saveFirst` | Save the draft first. A spectro result goes on a saved melt. | पहले ड्राफ़्ट सेव करें। स्पेक्ट्रो नतीजा सेव की हुई मेल्ट पर जुड़ता है। |
| `spectro.fromInbox` | Attach from inbox | इनबॉक्स से जोड़ें |
| `spectro.attachFile` | Attach a file or photo | फ़ाइल या फ़ोटो जोड़ें |
| `spectro.type` | Type the numbers | आँकड़े लिखें |
| `spectro.attached` | Spectro added | स्पेक्ट्रो जुड़ गया |
| `spectro.fileTooBig` | That file is too big. Use one under 700 kB. | फ़ाइल बहुत बड़ी है। 700 kB से छोटी लें। |
| `spectro.fileType` | Use a PDF, a photo or a text or CSV file. | PDF, फ़ोटो या टेक्स्ट/CSV फ़ाइल लें। |
| `spectro.inboxTitle` | Attach a file from the inbox | इनबॉक्स से फ़ाइल जोड़ें |
| `spectro.inboxFile` | File | फ़ाइल |
| `spectro.inboxPick` | Pick a file | फ़ाइल चुनें |
| `spectro.inboxEmpty` | No file is waiting in the inbox. | इनबॉक्स में कोई फ़ाइल इंतज़ार में नहीं। |
| `spectro.typeTitle` | Type the spectro numbers | स्पेक्ट्रो के आँकड़े लिखें |
| `spectro.typeHint` | Write each element in percent, for example 0.42. Leave empty what was not measured. Aluminium is the balance when you leave it empty. | हर तत्व प्रतिशत में लिखें, जैसे 0.42। जो नापा नहीं वह खाली छोड़ें। खाली छोड़ने पर एल्युमिनियम बाकी माना जाता है। |
| `spectro.typeReason` | Why are the numbers typed? | आँकड़े हाथ से क्यों लिखे? |
| `spectro.typeReasonHint` | For example: the printer is down. | जैसे: प्रिंटर बंद है। |
| `spectro.typeConfirm` | Save numbers | आँकड़े सेव करें |
| `spectro.typedBecause` | Typed because: {reason} | हाथ से लिखे क्योंकि: {reason} |
| `spectro.badNumber` | Not a number | अंक नहीं है |
| `spectro.enterOne` | Write at least one element. | कम से कम एक तत्व लिखें। |
| `spectro.overMillion` | The eight elements add up to more than 100 percent. | आठ तत्वों का जोड़ 100 प्रतिशत से ज़्यादा है। |
| `spectro.previewIs` | Against the limits: | सीमा के हिसाब से: |
| `spectro.reasonRequired` | Give a reason. | कारण लिखें। |
| `spectro.allVoid` | Every result on this melt is void. | इस मेल्ट के सारे नतीजे रद्द हैं। |
| `spectro.void` | Void | रद्द |
| `spectro.voidButton` | Void | रद्द करें |
| `spectro.voidTitle` | Void this result | यह नतीजा रद्द करें |
| `spectro.voidReason` | Why is it void? | क्यों रद्द? |
| `spectro.voidConfirm` | Void result | नतीजा रद्द करें |
| `stock.title` | Billet stock | बिलेट स्टॉक |
| `stock.subtitle` | Billets in the store by alloy and cast. The kg is the store ledger. | स्टोर के बिलेट अलॉय और कास्ट के हिसाब से। kg स्टोर का खाता है। |
| `stock.showFinished` | Show finished casts | पूरी हो चुकी कास्ट दिखाएं |
| `stock.finished` | Finished casts | पूरी हो चुकी कास्ट |
| `stock.empty` | No billets in stock. | स्टॉक में कोई बिलेट नहीं। |
| `stock.total` | {kg} kg of billets in stock | स्टॉक में {kg} kg बिलेट |
| `stock.alloyLine` | {kg} kg in {casts} {casts:cast\|casts} | {casts} कास्ट में {kg} kg |
| `stock.onHand` | On hand | हाथ में |
| `stock.loadFailed` | The billet stock did not load. Check the connection and try again. | बिलेट स्टॉक नहीं आया। कनेक्शन देखकर फिर कोशिश करें। |
| `cert.title` | Test certificate | टेस्ट सर्टिफ़िकेट |
| `cert.staffCopy` | Staff copy. Not a tax invoice. | स्टाफ़ कॉपी। टैक्स इनवॉइस नहीं। |
| `cert.period` | Cast month | कास्ट का महीना |
| `cert.fail` | Fail | फेल |
| `cert.noSpectro` | No spectro on melt {melts}. | मेल्ट {melts} पर स्पेक्ट्रो नहीं। |
| `cert.noSpectroMelt` | No spectro on melt {n}. | मेल्ट {n} पर स्पेक्ट्रो नहीं। |
| `cert.limitsNote` | Judged against the limits in force when the result was added. | नतीजा जुड़ते समय जो सीमाएं थीं, उनसे जाँचा गया। |
| `cert.bundles` | Bundles of this cast | इस कास्ट के बंडल |
| `cert.noBundles` | No bundle names this cast yet. | अभी किसी बंडल पर यह कास्ट नहीं लिखी। |
| `cert.footer` | Printed {date}. Staff copy, not a tax invoice. | {date} को प्रिंट। स्टाफ़ कॉपी, टैक्स इनवॉइस नहीं। |
| `masters.furnaces` | Furnaces | फर्नेस |
| `masters.furnacesSubtitle` | Each furnace has a capacity. A melt cannot be locked above it. | हर फर्नेस की एक क्षमता है। उससे ऊपर मेल्ट लॉक नहीं होती। |
| `masters.alloys` | Alloys | अलॉय |
| `masters.alloysSubtitle` | The elements and limits a spectro result is judged against. | वे तत्व और सीमाएं जिनसे स्पेक्ट्रो नतीजा जाँचा जाता है। |
| `masters.addFurnace` | Add furnace | फर्नेस जोड़ें |
| `masters.addAlloy` | Add alloy | अलॉय जोड़ें |
| `masters.editFurnace` | Edit furnace {code} | फर्नेस {code} बदलें |
| `masters.editAlloy` | Edit alloy {code} | अलॉय {code} बदलें |
| `masters.edit` | Edit | बदलें |
| `masters.code` | Code | कोड |
| `masters.codeInvalid` | Use letters, digits and dashes, up to 12. | अक्षर, अंक और डैश, 12 तक। |
| `masters.name` | Name | नाम |
| `masters.nameRequired` | Write a name. | नाम लिखें। |
| `masters.note` | Note | टिप्पणी |
| `masters.capacity` | Capacity | क्षमता |
| `masters.capacityKg` | Capacity (kg) | क्षमता (kg) |
| `masters.capacityHint` | The most metal one melt may hold. | एक मेल्ट में अधिकतम इतना मेटल। |
| `masters.capacityInvalid` | Write the capacity in kg. | क्षमता kg में लिखें। |
| `masters.billetDia` | Billet size (mm) | बिलेट साइज़ (mm) |
| `masters.diaInvalid` | Write a whole number of mm from 25 to 500. | 25 से 500 के बीच पूरा mm लिखें। |
| `masters.status` | Status | स्थिति |
| `masters.state.active` | Active | चालू |
| `masters.state.retired` | Retired | बंद |
| `masters.retire` | Retire | बंद करें |
| `masters.reactivate` | Make active again | फिर चालू करें |
| `masters.saved` | Saved | सेव हुआ |
| `masters.seeded` | Added | जोड़ दिया |
| `masters.noFurnace` | No furnace yet. | अभी कोई फर्नेस नहीं। |
| `masters.noFurnaceBody` | Add the furnace, or add the plant's default furnace in one go. | फर्नेस जोड़ें, या प्लांट की सामान्य फर्नेस एक बार में जोड़ें। |
| `masters.seedFurnace` | Add the default furnace | सामान्य फर्नेस जोड़ें |
| `masters.noAlloy` | No alloy yet. | अभी कोई अलॉय नहीं। |
| `masters.noAlloyBody` | Add the alloys the plant casts, or add 6063 and 6061 with their usual limits. | प्लांट जो अलॉय ढालता है वे जोड़ें, या 6063 और 6061 उनकी सामान्य सीमाओं के साथ जोड़ें। |
| `masters.seedAlloy` | Add 6063 and 6061 | 6063 और 6061 जोड़ें |
| `masters.limits` | Limits | सीमाएं |
| `masters.noLimits` | No limits | सीमा नहीं |
| `masters.editLimits` | Edit limits | सीमाएं बदलें |
| `masters.limitsTitle` | Limits of alloy {code} | अलॉय {code} की सीमाएं |
| `masters.limitsHint` | Write percent, for example 0.35. Leave a side empty for no limit. Aluminium is the balance unless you give it limits. | प्रतिशत लिखें, जैसे 0.35। जिस तरफ़ सीमा नहीं, वह खाली छोड़ें। एल्युमिनियम बाकी माना जाता है जब तक उसकी सीमा न दें। |
| `masters.limitsSnapshot` | Results already added keep the limits they were judged by. Only new results use these. | जो नतीजे पहले जुड़ चुके, वे अपनी पुरानी सीमाओं से जाँचे रहते हैं। सिर्फ़ नए नतीजे इन सीमाओं से जाँचे जाएंगे। |
| `masters.saveLimits` | Save limits | सीमाएं सेव करें |
| `masters.min` | Min % | न्यूनतम % |
| `masters.max` | Max % | अधिकतम % |
| `masters.limitInvalid` | Write percent like 0.35. | प्रतिशत 0.35 जैसा लिखें। |
| `masters.limitOrder` | The minimum is above the maximum. | न्यूनतम अधिकतम से ऊपर है। |
| `masters.loadFailed` | The list did not load. Check the connection and try again. | सूची नहीं आई। कनेक्शन देखकर फिर कोशिश करें। |
| `yield.title` | Foundry yield | फाउंड्री यील्ड |
| `yield.subtitle` | Locked melts only, by production day, alloy or furnace. A draft cannot improve the month. | सिर्फ़ लॉक मेल्ट, उत्पादन दिन, अलॉय या फर्नेस के हिसाब से। ड्राफ़्ट महीने को बेहतर नहीं दिखा सकता। |
| `yield.groupBy` | Group by | ऐसे बाँटें |
| `yield.group.day` | Day | दिन |
| `yield.group.alloy` | Alloy | अलॉय |
| `yield.group.furnace` | Furnace | फर्नेस |
| `yield.melts` | Melts | मेल्ट |
| `yield.in` | Metal in kg | डाला मेटल kg |
| `yield.logs` | Logs kg | लॉग kg |
| `yield.dross` | Dross kg | ड्रॉस kg |
| `yield.fe` | Iron kg | आयरन kg |
| `yield.burn` | Burn % | बर्न % |
| `yield.yield` | Yield % | यील्ड % |
| `yield.ldo` | LDO in per tonne | प्रति टन LDO |
| `yield.empty` | No locked melts in these days. | इन दिनों में कोई लॉक मेल्ट नहीं। |
| `yield.note` | LDO is inches of tank dip per tonne of metal charged, not litres. | LDO प्रति टन डाले गए मेटल पर टंकी की डिप के इंच हैं, लीटर नहीं। |
| `yield.csvName` | foundry-yield | foundry-yield |

### ageing (20)

| Key | English | हिंदी |
|---|---|---|
| `title` | Ageing | एजिंग |
| `board` | Ageing board | एजिंग बोर्ड |
| `readings.title` | Readings | रीडिंग |
| `readings.batch` | Batch {number} | बैच {number} |
| `readings.oven` | Oven | ओवन |
| `readings.temperature` | Temperature (°C) | तापमान (°C) |
| `readings.soak` | Soak time | सोक समय |
| `readings.start` | Start | शुरू |
| `readings.end` | End | खत्म |
| `readings.hardness` | Hardness | हार्डनेस |
| `readings.addReading` | Add reading | रीडिंग जोड़ें |
| `readings.saved` | Reading saved | रीडिंग सेव हुई |
| `readings.pass` | Pass | पास |
| `readings.fail` | Fail | फ़ेल |
| `readings.hold` | Hold | होल्ड |
| `readings.release` | Release | छोड़ें |
| `readings.rework` | Age again | फिर से एजिंग |
| `readings.scrap` | Scrap | स्क्रैप |
| `readings.empty` | No readings yet. | अभी कोई रीडिंग नहीं। |
| `readings.outOfRange` | Outside {min} to {max}. | {min} से {max} के बाहर। |

### reasons (66)

| Key | English | हिंदी |
|---|---|---|
| `kinds.downtime` | Downtime | रुकावट |
| `kinds.qc_reject` | Rejects | रिजेक्ट |
| `kinds.void` | Void | रद्द |
| `kinds.reprint` | Reprint | फिर से प्रिंट |
| `kinds.ageing_hold` | Ageing hold | एजिंग होल्ड |
| `kinds.ageing_rework` | Age again | फिर से एजिंग |
| `kinds.ageing_scrap` | Ageing scrap | एजिंग स्क्रैप |
| `kinds.reallocate` | Move to another order | दूसरे ऑर्डर में डालना |
| `kinds.die_work` | Die work | Die का काम |
| `kinds.melt_correct` | Correct a locked melt | लॉक मेल्ट का सुधार |
| `kinds.cast_tail` | Cast close-out | कास्ट क्लोज़-आउट |
| `downtime.die_change` | Die change | Die बदली |
| `downtime.billet_wait` | Waiting for billets | बिलेट का इंतज़ार |
| `downtime.breakdown` | Breakdown | ब्रेकडाउन |
| `downtime.power` | Power cut | बिजली गई |
| `downtime.no_order` | No order | ऑर्डर नहीं |
| `downtime.die_correction` | Die correction | Die सुधार |
| `downtime.quality_hold` | Quality hold | क्वालिटी होल्ड |
| `downtime.other` | Other | अन्य |
| `qc_reject.dimension` | Dimension | नाप |
| `qc_reject.surface` | Surface | सतह |
| `qc_reject.bend` | Bend | टेढ़ा |
| `qc_reject.crack` | Crack | दरार |
| `qc_reject.short_length` | Short length | छोटी लंबाई |
| `qc_reject.other` | Other | अन्य |
| `void.wrong_entry` | Wrong entry | गलत एंट्री |
| `void.damaged` | Damaged | खराब |
| `void.repacked` | Packed again | फिर से पैक |
| `void.other` | Other | अन्य |
| `reprint.label_damaged` | Label damaged | लेबल खराब |
| `reprint.printer_fault` | Printer fault | प्रिंटर खराब |
| `reprint.wrong_label` | Wrong label | गलत लेबल |
| `reprint.other` | Other | अन्य |
| `ageing_hold.hardness_low` | Hardness low | हार्डनेस कम |
| `ageing_hold.hardness_high` | Hardness high | हार्डनेस ज़्यादा |
| `ageing_hold.under_soak` | Under soak | सोक कम |
| `ageing_hold.surface` | Surface | सतह |
| `ageing_hold.bend` | Bend | टेढ़ा |
| `ageing_hold.customer` | Customer hold | ग्राहक का होल्ड |
| `ageing_hold.other` | Other | अन्य |
| `ageing_rework.hardness_low` | Hardness low | हार्डनेस कम |
| `ageing_rework.under_soak` | Under soak | सोक कम |
| `ageing_rework.other` | Other | अन्य |
| `ageing_scrap.bend` | Bend | टेढ़ा |
| `ageing_scrap.surface` | Surface | सतह |
| `ageing_scrap.short_length` | Short length | छोटी लंबाई |
| `ageing_scrap.other` | Other | अन्य |
| `reallocate.length_mismatch` | Different cut length | अलग कट लंबाई |
| `reallocate.customer_request` | Customer asked | ग्राहक ने कहा |
| `reallocate.packed_wrong_order` | Packed on the wrong order | गलत ऑर्डर पर पैक हुआ |
| `reallocate.other` | Other | अन्य |
| `die_work.polish` | Polish | पॉलिश |
| `die_work.correct` | Correction | करेक्शन |
| `die_work.inspect` | Inspection | जाँच |
| `die_work.clean` | Cleaning | सफ़ाई |
| `die_work.other` | Other | अन्य |
| `melt_correct.wrong_weight` | Wrong weight | गलत वज़न |
| `melt_correct.wrong_lot` | Wrong lot or stream | गलत लॉट या स्ट्रीम |
| `melt_correct.wrong_time` | Wrong time | गलत समय |
| `melt_correct.wrong_output` | Wrong logs or dross | गलत लॉग या ड्रॉस |
| `melt_correct.other` | Other | अन्य |
| `cast_tail.billets_short` | Press used more billets than the store held | प्रेस ने स्टोर से ज़्यादा बिलेट लिए |
| `cast_tail.scale_difference` | Scale difference | काँटे का फ़र्क |
| `cast_tail.remelted` | Billets sent back to the furnace | बिलेट फ़र्नेस में वापस गए |
| `cast_tail.scrapped` | Billets scrapped | बिलेट स्क्रैप हुए |
| `cast_tail.other` | Other | अन्य |

### plantSettings (50)

| Key | English | हिंदी |
|---|---|---|
| `title` | Plant settings | प्लांट सेटिंग |
| `shifts.title` | Shifts | शिफ्ट |
| `shifts.name` | Name | नाम |
| `shifts.start` | Starts | शुरू |
| `shifts.end` | Ends | खत्म |
| `shifts.add` | Add shift | शिफ्ट जोड़ें |
| `shifts.suggest` | Use Day and Night | दिन और रात लें |
| `shifts.none` | No shifts. Days start at midnight. | कोई शिफ्ट नहीं। दिन रात 12 बजे शुरू होता है। |
| `shifts.errors.count` | Keep 1 to 4 shifts. | 1 से 4 शिफ्ट रखें। |
| `shifts.errors.id` | Reload and try again. | पेज दोबारा लोड करके फिर कोशिश करें। |
| `shifts.errors.name_empty` | Give each shift a name. | हर शिफ्ट का नाम लिखें। |
| `shifts.errors.name_long` | Keep names under 40 characters. | नाम 40 अक्षर से छोटा रखें। |
| `shifts.errors.name_duplicate` | Two shifts have the same name. | दो शिफ्ट का एक ही नाम है। |
| `shifts.errors.minute_range` | Pick a time in the day. | दिन का कोई समय चुनें। |
| `shifts.errors.seq` | Reload and try again. | पेज दोबारा लोड करके फिर कोशिश करें। |
| `shifts.errors.zero_length` | A shift can't start and end at the same time. | शिफ्ट एक ही समय पर शुरू और खत्म नहीं हो सकती। |
| `shifts.errors.gap_or_overlap` | Shifts must cover the whole day with no gap or overlap. | शिफ्ट पूरा दिन ढकें, बीच में खाली या दोहरा समय न हो। |
| `standards.title` | Standards | स्टैंडर्ड |
| `standards.standard` | Standard | स्टैंडर्ड |
| `standards.cml` | Licence (CM/L) | लाइसेंस (CM/L) |
| `standards.solid` | Solid | सॉलिड |
| `standards.hollow` | Hollow | हॉलो |
| `standards.semi` | Semi hollow | सेमी हॉलो |
| `standards.semiFallback` | Left blank, semi hollow uses the solid one. | खाली छोड़ें तो सेमी हॉलो में सॉलिड वाला लगेगा। |
| `modules.title` | Modules | मॉड्यूल |
| `modules.hint` | Turn off what the plant doesn't use. | जो प्लांट में नहीं चलता उसे बंद करें। |
| `modules.names.customers` | Customers | ग्राहक |
| `modules.names.dies` | Dies | Die |
| `modules.names.bundles` | Bundles | Bundle |
| `modules.names.dispatches` | Dispatches | Dispatch |
| `modules.names.orders` | Orders | ऑर्डर |
| `modules.names.foundry` | Foundry | फ़ाउंड्री |
| `modules.names.press` | Press | प्रेस |
| `modules.names.ageing` | Ageing | एजिंग |
| `modules.names.store` | Store | स्टोर |
| `modules.names.purchase` | Scrap purchase | स्क्रैप खरीद |
| `letterhead.title` | Letterhead | लेटरहेड |
| `letterhead.legalName` | Legal name | कानूनी नाम |
| `letterhead.gstin` | GSTIN | GSTIN |
| `letterhead.address` | Address | पता |
| `letterhead.phone` | Phone | फ़ोन |
| `drift.title` | Die weight colours | Die वज़न के रंग |
| `drift.green` | In band up to (%) | बैंड में (%) तक |
| `drift.amber` | Near the edge up to (%) | किनारे के पास (%) तक |
| `recovery.title` | Recovery colours | रिकवरी के रंग |
| `recovery.green` | Good from (%) | अच्छी (%) से |
| `recovery.amber` | Watch from (%) | ध्यान दें (%) से |
| `orders.dieBands` | Use die bands | Die बैंड इस्तेमाल करें |
| `orders.priceOnSalesOrder` | Rates on orders | ऑर्डर पर रेट |
| `orders.dieRequired` | Order lines need a die copy or tier | ऑर्डर लाइन पर die कॉपी या टियर ज़रूरी |

### devices (62)

| Key | English | हिंदी |
|---|---|---|
| `collectors.title` | Collectors | कलेक्टर |
| `collectors.intro` | The limits a press reading must stay inside. A reading outside them raises an alert on Today and on the press alerts list. | प्रेस की रीडिंग जिस सीमा के अंदर रहनी चाहिए। सीमा से बाहर जाने पर आज के पेज और प्रेस अलर्ट सूची में अलर्ट आता है। |
| `collectors.line` | Press | प्रेस |
| `collectors.allLines` | Every press | हर प्रेस |
| `collectors.allLinesHint` | Used for a press that has no limits of its own. | उस प्रेस के लिए जिसकी अपनी सीमा नहीं है। |
| `collectors.metric` | Reading | रीडिंग |
| `collectors.min` | Lower limit | निचली सीमा |
| `collectors.max` | Upper limit | ऊपरी सीमा |
| `collectors.on` | On | चालू |
| `collectors.save` | Save | सेव करें |
| `collectors.saved` | Limits saved | सीमाएं सेव हुईं |
| `collectors.saveFailed` | Could not save the limits. Check the connection and try again. | सीमाएं सेव नहीं हुईं। कनेक्शन देखकर फिर कोशिश करें। |
| `collectors.invalid` | Give a lower or an upper limit, and keep the lower one below the upper. | निचली या ऊपरी सीमा लिखें, और निचली को ऊपरी से कम रखें। |
| `collectors.unitHint` | Units: ram speed in mm/s, temperatures in °C, pressure in bar. | इकाइयां: राम की रफ़्तार mm/s में, तापमान °C में, दबाव bar में। |
| `collectors.readOnly` | Only a manager or the admin can change these limits. | ये सीमाएं सिर्फ़ मैनेजर या एडमिन बदल सकते हैं। |
| `collectors.alertsLink` | Open the press alerts | प्रेस अलर्ट खोलें |
| `collectors.inboxLink` | Open the spectro inbox | स्पेक्ट्रो इनबॉक्स खोलें |
| `collectors.inboxWaiting` | {count} waiting | {count} इंतज़ार में |
| `collectors.loadFailed` | The limits did not load. Check the connection and try again. | सीमाएं नहीं आईं। कनेक्शन देखकर फिर कोशिश करें। |
| `collectors.noLines` | No press line yet. Add one under Press first. | अभी कोई प्रेस लाइन नहीं। पहले प्रेस में एक जोड़ें। |
| `title` | Devices | डिवाइस |
| `label` | Name | नाम |
| `lastSeen` | Last seen {time} | आखिरी बार {time} |
| `revoke` | Sign out this device | इस डिवाइस से साइन आउट करें |
| `revoked` | Signed out | साइन आउट हो गया |
| `gateTitle` | App builds | ऐप बिल्ड |
| `gateHint` | One app, {app}, runs on every tablet and phone. A build below the minimum cannot open the floor. | हर टैबलेट और फ़ोन पर एक ही ऐप, {app}, चलता है। न्यूनतम बिल्ड से नीचे का बिल्ड फ़्लोर नहीं खोल सकता। |
| `latest` | Latest {version}, build {build} | नवीनतम {version}, बिल्ड {build} |
| `minimum` | Minimum build {build} | न्यूनतम बिल्ड {build} |
| `nothing` | Nothing published yet | अभी कुछ प्रकाशित नहीं हुआ |
| `notesLabel` | What changed | क्या बदला |
| `platformAndroid` | Android floor app | Android फ़्लोर ऐप |
| `platformAndroidProduction` | Android | Android |
| `platformIos` | iPhone and iPad | iPhone और iPad |
| `listTitle` | Devices that opened the app | जिन डिवाइस पर ऐप खुला |
| `unnamed` | Unnamed device | बिना नाम का डिवाइस |
| `person` | Used by {name} | {name} इस्तेमाल करते हैं |
| `factPlatform` | Platform | प्लेटफ़ॉर्म |
| `factApp` | App version | ऐप वर्शन |
| `factSeen` | Last seen | आखिरी बार |
| `factDay` | Production day | प्रोडक्शन का दिन |
| `seenThisDay` | Seen this production day | प्रोडक्शन के इस दिन दिखा |
| `seenEarlier` | Seen earlier | पहले दिखा था |
| `status.current` | Current | चालू बिल्ड |
| `status.blocked` | Below minimum build | न्यूनतम बिल्ड से नीचे |
| `status.revoked` | Signed out | साइन आउट |
| `status.web` | Web | वेब |
| `status.unknown` | Build not reported | बिल्ड की जानकारी नहीं |
| `rename` | Rename | नाम बदलें |
| `renameTitle` | Name this device | इस डिवाइस को नाम दें |
| `renamed` | Name saved | नाम सेव हो गया |
| `renameFailed` | Couldn't save the name. Try again. | नाम सेव नहीं हुआ। फिर कोशिश करें। |
| `revokeTitle` | Sign out this device? | इस डिवाइस से साइन आउट करें? |
| `revokeBody` | {name} stops working until you allow it again. Its record stays. | {name} तब तक नहीं चलेगा जब तक आप फिर इजाज़त न दें। इसका रिकॉर्ड रहेगा। |
| `revokeConfirm` | Sign out device | डिवाइस साइन आउट करें |
| `revokedDone` | Device signed out | डिवाइस साइन आउट हो गया |
| `restore` | Allow again | फिर इजाज़त दें |
| `restored` | Device allowed again | डिवाइस को फिर इजाज़त मिल गई |
| `empty` | No device has opened the app yet. | अभी किसी डिवाइस पर ऐप नहीं खुला। |
| `loadFailed` | Couldn't load the devices. Try again. | डिवाइस लोड नहीं हुए। फिर कोशिश करें। |
| `actionFailed` | That didn't work. Try again. | यह नहीं हुआ। फिर कोशिश करें। |
| `readOnly` | Only owners and admins can manage devices. | डिवाइस सिर्फ़ मालिक और एडमिन संभाल सकते हैं। |

### backups (25)

| Key | English | हिंदी |
|---|---|---|
| `title` | Backups | बैकअप |
| `run` | Back up now | अभी बैकअप लें |
| `last` | Last backup {time} | आखिरी बैकअप {time} |
| `status.running` | Running | चल रहा है |
| `status.succeeded` | Done | हो गया |
| `status.failed` | Failed | नहीं हुआ |
| `status.ok` | Done | हो गया |
| `lastOk` | Last good backup | आखिरी सही बैकअप |
| `none` | No backup yet. The first one runs overnight. | अभी कोई बैकअप नहीं। पहला रात में चलेगा। |
| `lastAttempt` | Last try: {status}, {time} | आखिरी कोशिश: {status}, {time} |
| `size` | {mb} megabytes | {mb} मेगाबाइट |
| `drillTitle` | Restore drill | रिस्टोर ड्रिल |
| `drillNone` | No restore drill yet. orrn runs one every quarter. | अभी कोई रिस्टोर ड्रिल नहीं हुई। orrn हर तिमाही एक चलाता है। |
| `drillBody` | A drill restores the latest backup into a scratch copy and compares the counts of customers, dies, bundles and dispatches. Your live data is not touched. | ड्रिल में ताज़ा बैकअप को एक अलग कॉपी में बहाल करके ग्राहक, die, bundle और dispatch की गिनती मिलाई जाती है। आपका असली डेटा नहीं छुआ जाता। |
| `drillLast` | Last drill: {status}, {time} | आखिरी ड्रिल: {status}, {time} |
| `runbook` | Ask orrn support to run the restore drill. It is done every quarter. | रीस्टोर ड्रिल चलवाने के लिए orrn सपोर्ट से कहें। यह हर तिमाही होती है। |
| `cardHint` | Status only. There is no download: the plant can't fetch or restore its own backup. | सिर्फ़ स्थिति दिखती है। डाउनलोड नहीं है: प्लांट अपना बैकअप खुद नहीं ले या बहाल कर सकता। |
| `staffTitle` | For orrn staff | orrn स्टाफ़ के लिए |
| `runNow` | Back up now | अभी बैकअप लें |
| `runDrill` | Run restore drill | रिस्टोर ड्रिल चलाएं |
| `started` | Backup finished | बैकअप पूरा हुआ |
| `drillStarted` | Restore drill finished | रिस्टोर ड्रिल पूरी हुई |
| `failedToRun` | That didn't finish. See the status above. | यह पूरा नहीं हुआ। ऊपर स्थिति देखें। |
| `loadFailed` | Couldn't load the backup status. Try again. | बैकअप की स्थिति लोड नहीं हुई। फिर कोशिश करें। |
| `readOnly` | Only owners and admins can see backups. | बैकअप सिर्फ़ मालिक और एडमिन देख सकते हैं। |

### support (21)

| Key | English | हिंदी |
|---|---|---|
| `title` | Help | मदद |
| `ask` | Ask for help | मदद मांगें |
| `subject` | Subject | विषय |
| `body` | What happened | क्या हुआ |
| `sent` | Sent. The reply shows up here. | भेज दिया। जवाब यहां दिखेगा। |
| `reply` | Reply | जवाब |
| `status.open` | Open | खुला |
| `status.answered` | Answered | जवाब मिला |
| `status.closed` | Closed | बंद |
| `subjectHint` | Optional. A few words. | वैकल्पिक। कुछ शब्द। |
| `bodyHint` | Say what you were doing and what you saw. Up to 2000 characters. | बताएं कि आप क्या कर रहे थे और क्या दिखा। ज़्यादा से ज़्यादा 2000 अक्षर। |
| `bodyRequired` | Write a few words about what happened. | क्या हुआ, इसके कुछ शब्द लिखें। |
| `submit` | Send | भेजें |
| `sendFailed` | The request didn't send. Try again. | अनुरोध नहीं गया। फिर कोशिश करें। |
| `mine` | Your requests | आपके अनुरोध |
| `empty` | You haven't asked for help yet. | आपने अभी तक मदद नहीं मांगी। |
| `waiting` | Waiting for a reply. | जवाब का इंतज़ार है। |
| `fromScreen` | From {screen} | {screen} से |
| `replyFrom` | Reply from orrn | orrn का जवाब |
| `loadFailed` | Couldn't load your requests. Try again. | आपके अनुरोध लोड नहीं हुए। फिर कोशिश करें। |
| `cantAsk` | Your role can't send help requests. | आपकी भूमिका मदद का अनुरोध नहीं भेज सकती। |

### audit (49)

| Key | English | हिंदी |
|---|---|---|
| `title` | Audit log | ऑडिट लॉग |
| `subtitle` | Who changed what in your plant. You can read it, not edit or remove it. | आपके प्लांट में किसने क्या बदला। इसे पढ़ सकते हैं, बदल या हटा नहीं सकते। |
| `filters` | Filters | फ़िल्टर |
| `actor` | Person | व्यक्ति |
| `anyone` | Everyone | सभी |
| `kind` | Kind | प्रकार |
| `anyKind` | Everything | सब कुछ |
| `subject` | Subject | विषय |
| `subjectHint` | The id in an entry's Subject column | एंट्री के विषय कॉलम की आईडी |
| `from` | From | से |
| `to` | To | तक |
| `clear` | Clear filters | फ़िल्टर हटाएं |
| `kinds.company` | Settings | सेटिंग्स |
| `kinds.member` | Team | टीम |
| `kinds.device` | Devices | डिवाइस |
| `kinds.dispatch` | Dispatches | Dispatch |
| `kinds.bundle` | Bundles | Bundle |
| `kinds.die` | Dies | Die |
| `kinds.customer` | Customers | ग्राहक |
| `kinds.stock` | Stock | स्टॉक |
| `kinds.order` | Orders | ऑर्डर |
| `kinds.count` | Stock counts | स्टॉक गिनती |
| `kinds.support_request` | Help requests | मदद के अनुरोध |
| `kinds.backup` | Backups | बैकअप |
| `kinds.press` | Press | प्रेस |
| `kinds.foundry` | Foundry | फाउंड्री |
| `kinds.purchase` | Buying and stores | खरीद और स्टोर |
| `kinds.approval` | Approvals | मंज़ूरियां |
| `kinds.platform` | orrn support | orrn सपोर्ट |
| `valueYes` | Yes | हां |
| `valueNo` | No | नहीं |
| `valueNone` | none | कुछ नहीं |
| `change` | {from} to {to} | {from} से {to} |
| `columns.when` | When | कब |
| `columns.who` | Who | किसने |
| `columns.what` | What | क्या |
| `columns.subject` | Subject | विषय |
| `byStaff` | orrn support | orrn सपोर्ट |
| `unknownActor` | System | सिस्टम |
| `details` | Details | जानकारी |
| `showMore` | Show older entries | पुरानी एंट्री दिखाएं |
| `loadingMore` | Loading | लोड हो रहा है |
| `since` | Showing entries since {date}. Older ones are kept. | {date} से एंट्री दिख रही हैं। पुरानी रखी हुई हैं। |
| `empty` | Nothing matches these filters | इन फ़िल्टर से कुछ नहीं मिला |
| `emptyBody` | Try a wider range of dates or clear a filter. | तारीखों की सीमा बढ़ाएं या कोई फ़िल्टर हटाएं। |
| `emptyNone` | Nothing has been recorded yet | अभी कुछ दर्ज नहीं हुआ |
| `loadFailed` | Couldn't load the audit log. Try again. | ऑडिट लॉग लोड नहीं हुआ। फिर कोशिश करें। |
| `listLabel` | Audit entries | ऑडिट एंट्री |
| `noAccess` | Your role can't read the audit log. Ask an owner, admin or manager. | आपकी भूमिका ऑडिट लॉग नहीं पढ़ सकती। मालिक, एडमिन या मैनेजर से कहें। |

### portal (185)

| Key | English | हिंदी |
|---|---|---|
| `title` | Party portal | पार्टी पोर्टल |
| `signedInAs` | Signed in for {party} | {party} के लिए साइन इन |
| `switchPlant` | Plant | प्लांट |
| `nav.label` | Portal | पोर्टल |
| `nav.tabs` | Portal sections | पोर्टल के हिस्से |
| `nav.today` | Today | आज |
| `nav.orders` | Orders | ऑर्डर |
| `nav.dies` | Dies | Die |
| `nav.dispatches` | Dispatches | डिस्पैच |
| `account.open` | Open account menu | खाता मेन्यू खोलें |
| `account.title` | Your account | आपका खाता |
| `invite.title` | Your party login | आपका पार्टी लॉगिन |
| `invite.body` | Create your password to see your dies, orders and dispatches. | अपने die, ऑर्डर और डिस्पैच देखने के लिए पासवर्ड बनाएं। |
| `invite.joined` | Your party login is ready | आपका पार्टी लॉगिन तैयार है |
| `today.openOrders` | Open orders | खुले ऑर्डर |
| `today.baki` | Baki | बाकी |
| `today.bakiHint` | Still to dispatch on your open orders | आपके खुले ऑर्डर का अभी भेजना बाकी |
| `today.lastDispatch` | Last dispatch | पिछला डिस्पैच |
| `today.noDispatch` | No dispatch yet | अभी कोई डिस्पैच नहीं |
| `today.noOrder` | No open order | कोई खुला ऑर्डर नहीं |
| `today.placeOrder` | Place an order | ऑर्डर दें |
| `dies.title` | Your dies | आपके die |
| `dies.subtitle` | Dies the plant has opened for you, and the ones you own. | प्लांट ने जो die आपके लिए खोले हैं, और जो आपके अपने हैं। |
| `dies.empty` | The plant has not opened any die for you yet. | प्लांट ने अभी आपके लिए कोई die नहीं खोला है। |
| `dies.copy` | Copy | कॉपी |
| `dies.latest` | Latest kg/12ft | ताज़ा kg/12ft |
| `dies.noReading` | No reading yet | अभी कोई रीडिंग नहीं |
| `dies.noCopies` | No copy of this die yet | इस die की अभी कोई कॉपी नहीं |
| `dies.band` | Band | बैंड |
| `dies.bandRange` | Band {min} to {max} kg/12ft | बैंड {min} से {max} kg/12ft |
| `dies.inBand` | In band | बैंड में |
| `dies.overBand` | Over band by {kg} kg/12ft | बैंड से {kg} kg/12ft ऊपर |
| `dies.underBand` | Under band by {kg} kg/12ft | बैंड से {kg} kg/12ft नीचे |
| `dies.owned` | Yours | आपका |
| `dies.granted` | Opened for you | आपके लिए खुला |
| `orders.title` | Orders | ऑर्डर |
| `orders.empty` | No order yet | अभी कोई ऑर्डर नहीं |
| `orders.new` | New order | नया ऑर्डर |
| `orders.newSubtitle` | Book a die, a cut length and how many. The plant picks the die copy and sets the rate. | die, कट लंबाई और कितना चाहिए, बुक करें। die की कॉपी और रेट प्लांट तय करता है। |
| `orders.number` | Order | ऑर्डर |
| `orders.date` | Date | तारीख |
| `orders.poNumber` | Your PO number | आपका PO नंबर |
| `orders.poHint` | Optional. Your own reference. | वैकल्पिक। आपका अपना संदर्भ। |
| `orders.section` | Die | Die |
| `orders.pickSection` | Pick a die | Die चुनें |
| `orders.cutLength` | Cut length | कट लंबाई |
| `orders.lengthHintInch` | Feet and inches, like 12 ft or 11 ft 6 in. | फ़ुट और इंच में, जैसे 12 ft या 11 ft 6 in। |
| `orders.lengthHintMm` | In millimetres, like 3658. | मिलीमीटर में, जैसे 3658। |
| `orders.feet` | Feet | फ़ुट |
| `orders.inches` | Inches | इंच |
| `orders.pieces` | Pieces | पीस |
| `orders.kg` | kg | kg |
| `orders.piecesOrKg` | Order by | ऑर्डर का तरीका |
| `orders.note` | Note | नोट |
| `orders.lineNote` | Note for this line | इस लाइन का नोट |
| `orders.addLine` | Add line | लाइन जोड़ें |
| `orders.removeLine` | Remove line | लाइन हटाएं |
| `orders.maxLines` | At most {count} lines on one order. | एक ऑर्डर में अधिकतम {count} लाइन। |
| `orders.lineNo` | Line {n} | लाइन {n} |
| `orders.lines` | Lines | लाइनें |
| `orders.submit` | Place order | ऑर्डर दें |
| `orders.placed` | Order {number} is booked. The plant will confirm it. | ऑर्डर {number} बुक हो गया। प्लांट इसे कन्फ़र्म करेगा। |
| `orders.confirmation` | Your booking is with the office | आपकी बुकिंग ऑफ़िस के पास है |
| `orders.viewOrder` | View order | ऑर्डर देखें |
| `orders.waiting` | Your booking is with the office. They will confirm it. | आपकी बुकिंग ऑफ़िस के पास है। वे इसे कन्फ़र्म करेंगे। |
| `orders.noRate` | The plant sets the rate. You do not enter one. | रेट प्लांट तय करता है। आपको रेट नहीं भरना है। |
| `orders.ordered` | Ordered | ऑर्डर |
| `orders.dispatched` | Dispatched | भेजा गया |
| `orders.baki` | Baki | बाकी |
| `orders.bakiHint` | Baki = still to deliver | बाकी = अभी भेजना बाकी |
| `orders.statusLabel` | Status | स्थिति |
| `orders.filterLabel` | Show orders | ऑर्डर दिखाएं |
| `orders.filterOpen` | Open | खुले |
| `orders.filterAll` | All | सभी |
| `orders.showMore` | Show more | और दिखाएं |
| `orders.status.booking` | Booking | बुकिंग |
| `orders.status.confirmed` | Confirmed | कन्फ़र्म |
| `orders.status.dispatching` | Dispatching | भेजा जा रहा है |
| `orders.status.closed` | Closed | बंद |
| `orders.status.cancelled` | Cancelled | रद्द |
| `orders.errors.section` | Pick a die. | Die चुनें। |
| `orders.errors.length` | Enter the cut length. | कट लंबाई भरें। |
| `orders.errors.qty` | Enter a whole number of pieces, or the kg. | पीस की पूरी संख्या या kg भरें। |
| `orders.errors.dieClosed` | That die is no longer open for you. Go back and pick another die. | यह Die अब आपके लिए खुला नहीं है। वापस जाकर दूसरा Die चुनें। |
| `orders.errors.noLines` | Add at least one line. | कम से कम एक लाइन जोड़ें। |
| `orders.errors.tooManyLines` | An order can have at most 20 lines. Place the rest as a second order. | एक ऑर्डर में ज़्यादा से ज़्यादा 20 लाइन हो सकती हैं। बाकी दूसरे ऑर्डर में दें। |
| `orders.errors.plantPicks` | The plant picks the die copy and sets the rate. Leave those out. | Die की कॉपी और रेट प्लांट तय करता है। इन्हें न भेजें। |
| `orders.errors.range` | A length or quantity is outside what the plant can take. Check the numbers. | कोई लंबाई या मात्रा प्लांट की सीमा से बाहर है। संख्याएं जांचें। |
| `orders.errors.poUsed` | This PO number is already on another order of yours. Use a new PO number. | यह PO नंबर आपके दूसरे ऑर्डर पर पहले से है। नया PO नंबर डालें। |
| `orders.errors.reload` | This order was already saved. Open Orders to see it. | यह ऑर्डर पहले ही सेव हो चुका है। ऑर्डर खोलकर देखें। |
| `orders.errors.ordersOff` | The plant has not turned on orders for the portal. | प्लांट ने पोर्टल पर ऑर्डर चालू नहीं किए हैं। |
| `dispatches.title` | Dispatches | डिस्पैच |
| `dispatches.subtitle` | What the plant has sent you, with the packing list and test certificate. | प्लांट ने आपको जो भेजा, पैकिंग लिस्ट और टेस्ट सर्टिफिकेट के साथ। |
| `dispatches.empty` | No dispatch yet | अभी कोई डिस्पैच नहीं |
| `dispatches.code` | Dispatch | डिस्पैच |
| `dispatches.date` | Date | तारीख |
| `dispatches.plNo` | PL no | PL नंबर |
| `dispatches.vehicle` | Vehicle | गाड़ी |
| `dispatches.bundlesLabel` | Bundles | बंडल |
| `dispatches.weight` | kg | kg |
| `dispatches.totals` | {bundles} bundles, {pcs} pcs, {kg} kg | {bundles} बंडल, {pcs} पीस, {kg} kg |
| `dispatches.noPl` | The packing list is not ready yet. | पैकिंग लिस्ट अभी तैयार नहीं है। |
| `dispatches.downloadPl` | Download packing list | पैकिंग लिस्ट डाउनलोड करें |
| `dispatches.print` | Print | प्रिंट |
| `dispatches.viewCertificate` | Test certificate | टेस्ट सर्टिफिकेट |
| `certificate.title` | Test certificate | टेस्ट सर्टिफिकेट |
| `certificate.number` | Certificate no | सर्टिफिकेट नंबर |
| `certificate.revision` | revision {n} | रिविज़न {n} |
| `certificate.issuedOn` | Issued on | जारी तारीख |
| `certificate.dispatch` | Dispatch | डिस्पैच |
| `certificate.customer` | Supplied to | इन्हें भेजा गया |
| `certificate.material` | Material | माल |
| `certificate.chemistry` | Chemistry | केमिस्ट्री |
| `certificate.cast` | Cast | कास्ट |
| `certificate.castPending` | Chemistry pending | केमिस्ट्री बाकी |
| `certificate.verdict.pass` | Passed | पास |
| `certificate.verdict.fail` | Failed | फ़ेल |
| `certificate.verdict.incomplete` | Incomplete | अधूरा |
| `certificate.chemistryPending` | Chemistry pending: the plant has not tested these casts yet. | केमिस्ट्री बाकी: प्लांट ने इन कास्ट की जांच अभी नहीं की है। |
| `certificate.chemistryPartial` | Chemistry for {tested} of {total} bundles that name a cast. The rest are not tested yet. | कास्ट वाले {total} बंडल में से {tested} की केमिस्ट्री। बाकी की जांच अभी नहीं हुई। |
| `certificate.noCastBundles` | {n} bundles have no cast number | {n} बंडल पर कास्ट नंबर नहीं है |
| `certificate.noCastBundlesOne` | 1 bundle has no cast number | 1 बंडल पर कास्ट नंबर नहीं है |
| `certificate.castsFailed` | {n} casts failed chemistry | {n} कास्ट केमिस्ट्री में फ़ेल हुए |
| `certificate.castsFailedOne` | 1 cast failed chemistry | 1 कास्ट केमिस्ट्री में फ़ेल हुआ |
| `certificate.chemistryReady` | Chemistry of each cast behind this dispatch, in percent. | इस डिस्पैच के हर कास्ट की केमिस्ट्री, प्रतिशत में। |
| `certificate.standard` | Standard | स्टैंडर्ड |
| `certificate.licence` | CM/L | CM/L |
| `certificate.standardAsOfIssue` | Standard as of the day this certificate was issued. | स्टैंडर्ड वही है जो सर्टिफिकेट जारी करने के दिन था। |
| `certificate.profileKindNotSet` | Profile kind not set: the solid standard is shown. | प्रोफ़ाइल का प्रकार तय नहीं है: सॉलिड स्टैंडर्ड दिखाया गया है। |
| `certificate.alBalance` | Al is the balance of the other eight, not measured. | Al बाकी आठ का शेष है, मापा नहीं गया। |
| `certificate.notTaxDocument` | Quality document. Not a tax invoice. | क्वालिटी दस्तावेज़। टैक्स इनवॉइस नहीं। |
| `errors.notFound` | Not found | नहीं मिला |
| `errors.notFoundBody` | There is nothing here for you. Check the link. | यहां आपके लिए कुछ नहीं है। लिंक जांचें। |
| `errors.backToPlant` | Back to Today | आज पर लौटें |
| `errors.revoked` | Your login was turned off by the plant. Ask them to turn it on again. | प्लांट ने आपका लॉगिन बंद कर दिया है। उनसे दोबारा चालू करने को कहें। |
| `errors.loadFailed` | Could not load your portal | आपका पोर्टल लोड नहीं हो सका |
| `errors.loadFailedBody` | Check your connection and try again. | अपना कनेक्शन जांचें और फिर कोशिश करें। |
| `errors.disabled` | The plant has turned the party portal off. | प्लांट ने पार्टी पोर्टल बंद कर रखा है। |
| `errors.noAccess` | This login has no party portal. | इस लॉगिन के लिए कोई पार्टी पोर्टल नहीं है। |
| `errors.wrongPlant` | You do not have a login in that plant. | उस प्लांट में आपका लॉगिन नहीं है। |
| `errors.member` | This login works in the plant. Use the plant screens. | यह लॉगिन प्लांट में चलता है। प्लांट की स्क्रीन इस्तेमाल करें। |
| `staff.accessTitle` | Portal access | पोर्टल एक्सेस |
| `staff.accessBody` | Logins for this party and the dies the party can see and book. The portal never shows a rate. | इस पार्टी के लॉगिन और वे die जो पार्टी देख और बुक कर सकती है। पोर्टल में रेट कभी नहीं दिखता। |
| `staff.logins` | Logins | लॉगिन |
| `staff.noLogins` | No login yet | अभी कोई लॉगिन नहीं |
| `staff.grant` | Give a login | लॉगिन दें |
| `staff.grantTitle` | Give a party a login | पार्टी को लॉगिन दें |
| `staff.grantSubmit` | Give login | लॉगिन दें |
| `staff.granted` | Login given to {email} | {email} को लॉगिन दिया गया |
| `staff.regranted` | Login for {email} is on again | {email} का लॉगिन फिर चालू है |
| `staff.revoke` | Turn off | बंद करें |
| `staff.revokedToast` | Login turned off | लॉगिन बंद किया गया |
| `staff.turnOn` | Turn on | चालू करें |
| `staff.newLink` | New link | नया लिंक |
| `staff.email` | Email | ईमेल |
| `staff.party` | Party | पार्टी |
| `staff.status` | Status | स्थिति |
| `staff.since` | Since | तब से |
| `staff.pickParty` | Pick the party. | पार्टी चुनें। |
| `staff.status_invited` | Invited | न्योता भेजा |
| `staff.status_active` | Active | चालू |
| `staff.status_revoked` | Off | बंद |
| `staff.inviteLink` | Invite link | न्योते का लिंक |
| `staff.copyLink` | Copy link | लिंक कॉपी करें |
| `staff.linkTitle` | Invite link for {email} | {email} के लिए न्योते का लिंक |
| `staff.linkHint` | If the email does not arrive, send this link to the party. It works for 7 days. | अगर ईमेल न पहुंचे तो यह लिंक पार्टी को भेज दें। यह 7 दिन चलता है। |
| `staff.sections` | Dies the party sees | पार्टी को दिखने वाले die |
| `staff.noSections` | No die opened yet | अभी कोई die नहीं खोला |
| `staff.grantSection` | Open a die | Die खोलें |
| `staff.revokeSection` | Close | बंद करें |
| `staff.sectionGranted` | Die opened for the party | पार्टी के लिए die खोला गया |
| `staff.sectionRevoked` | Die closed for the party | पार्टी के लिए die बंद किया गया |
| `staff.ownedByOther` | Another party owns this die. The party will not see it. | इस die का मालिक दूसरी पार्टी है। यह पार्टी इसे नहीं देखेगी। |
| `staff.portalOff` | Turn on the party portal in Settings first. | पहले सेटिंग में पार्टी पोर्टल चालू करें। |
| `staff.alreadyActive` | This login is already active. | यह लॉगिन पहले से चालू है। |
| `staff.plantLogin` | This email is a plant login. Use another email for the party. | यह ईमेल प्लांट का लॉगिन है। पार्टी के लिए दूसरा ईमेल इस्तेमाल करें। |
| `staff.otherParty` | This email already signs in for another party. | यह ईमेल पहले से दूसरी पार्टी के लिए साइन इन करता है। |
| `staff.alreadyGranted` | This party already sees this die. | यह पार्टी यह die पहले से देखती है। |
| `staff.issueCertificate` | Issue test certificate | टेस्ट सर्टिफिकेट जारी करें |
| `staff.reissueCertificate` | Issue again | फिर से जारी करें |
| `staff.noCertificate` | Not issued yet | अभी जारी नहीं हुआ |
| `staff.certificateIssued` | Certificate {number} revision {revision} issued | सर्टिफिकेट {number} रिविज़न {revision} जारी हुआ |
| `staff.chemistry_pending` | Chemistry pending | केमिस्ट्री बाकी |
| `staff.chemistry_partial` | Chemistry partly tested | केमिस्ट्री आंशिक जांची गई |
| `staff.chemistry_ready` | Chemistry ready | केमिस्ट्री तैयार |

### reports (120)

| Key | English | हिंदी |
|---|---|---|
| `title` | Reports | रिपोर्ट |
| `subtitle` | Production, die life, stock age and the order book. The server works out every figure. | प्रोडक्शन, die की लाइफ, स्टॉक की उम्र और ऑर्डर बुक। हर आंकड़ा सर्वर निकालता है। |
| `csv` | Download CSV | CSV डाउनलोड करें |
| `downloadFailed` | The CSV did not download. Try again. | CSV डाउनलोड नहीं हुई। फिर से कोशिश करें। |
| `loadFailed` | The report did not load. | रिपोर्ट नहीं खुली। |
| `from` | From | से |
| `to` | To | तक |
| `total` | Total | कुल |
| `monthsShort` | Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec | जन॰,फ़र॰,मार्च,अप्रै॰,मई,जून,जुला॰,अग॰,सित॰,अक्टू॰,नव॰,दिस॰ |
| `showMore` | Show more | और दिखाएं |
| `clear` | Clear | हटाएं |
| `noAccess` | Reports are for the office, managers, the accountant and supervisors. | रिपोर्ट ऑफिस, मैनेजर, अकाउंटेंट और सुपरवाइज़र के लिए हैं। |
| `list.production` | Production | प्रोडक्शन |
| `list.productionBody` | The press report, with recovery by die, press and shift. | प्रेस रिपोर्ट, die, प्रेस और शिफ्ट के हिसाब से रिकवरी के साथ। |
| `list.dieLife` | Die life | Die की लाइफ |
| `list.dieLifeBody` | What each die copy has pressed against its planned life. | हर die copy ने अपनी तय लाइफ में से कितना माल निकाला। |
| `list.stockAge` | Stock age | स्टॉक की उम्र |
| `list.stockAgeBody` | Bundles in the yard by days since packing, per party and plant stock. | यार्ड में पड़े bundle, पैकिंग से कितने दिन हुए, पार्टी और प्लांट स्टॉक के हिसाब से। |
| `list.orders` | Order book | ऑर्डर बुक |
| `list.ordersBody` | Ordered, dispatched, baki and late orders by party and by month. | पार्टी और महीने के हिसाब से ऑर्डर, dispatch, बाकी और लेट ऑर्डर। |
| `list.foundryYield` | Foundry yield | फाउंड्री यील्ड |
| `list.foundryYieldBody` | Metal in, logs, dross, burn and yield of locked melts by day, alloy and furnace. | लॉक मेल्ट का डाला मेटल, लॉग, ड्रॉस, बर्न और यील्ड, दिन, अलॉय और फर्नेस के हिसाब से। |
| `production.title` | Production report | प्रोडक्शन रिपोर्ट |
| `production.subtitle` | Logged runs of the production days, then recovery by die, press and shift. | प्रोडक्शन दिनों के लॉग हुए रन, फिर die, प्रेस और शिफ्ट के हिसाब से रिकवरी। |
| `production.recoveryTitle` | Recovery | रिकवरी |
| `production.recoveryNote` | Production runs only. Each row is its good kg over its billet kg, never an average of percents. | सिर्फ प्रोडक्शन रन। हर लाइन में उसका अच्छा kg भाग उसके बिलेट kg, प्रतिशतों का औसत नहीं। |
| `production.groupBy` | Group by | किस हिसाब से |
| `production.group.die` | Die | Die |
| `production.group.copy` | Die copy | Die copy |
| `production.group.press` | Press | प्रेस |
| `production.group.shift` | Shift | शिफ्ट |
| `production.runs` | Runs | रन |
| `production.input` | Billets kg | बिलेट kg |
| `production.good` | Good kg | अच्छा kg |
| `production.scrap` | Butt, ends and rejects kg | बट, एंड और रिजेक्ट kg |
| `production.recovery` | Recovery % | रिकवरी % |
| `production.none` | None | कोई नहीं |
| `production.empty` | No production runs logged in these days. | इन दिनों में कोई प्रोडक्शन रन लॉग नहीं हुआ। |
| `production.chartTitle` | Recovery % | रिकवरी % |
| `production.chartLabel` | Recovery percent by row | हर लाइन की रिकवरी प्रतिशत |
| `production.csvName` | recovery | recovery |
| `dieLife.title` | Die life | Die की लाइफ |
| `dieLife.subtitle` | Die copies by the share of their planned life used. Pressed is the good kg of the copy's logged runs. | Die copy, तय लाइफ में से कितनी इस्तेमाल हुई उसके हिसाब से। निकाला हुआ माल copy के लॉग हुए रन का अच्छा kg है। |
| `dieLife.copy` | Die copy | Die copy |
| `dieLife.section` | Section | सेक्शन |
| `dieLife.status` | Status | स्थिति |
| `dieLife.life` | Life kg | लाइफ kg |
| `dieLife.pressed` | Pressed kg | निकाला kg |
| `dieLife.used` | Used | इस्तेमाल |
| `dieLife.left` | Left kg | बाकी kg |
| `dieLife.runs` | Runs | रन |
| `dieLife.lastRun` | Last run | आखिरी रन |
| `dieLife.noLife` | No life set | लाइफ तय नहीं |
| `dieLife.reached` | Life reached | लाइफ पूरी |
| `dieLife.usedPct` | {pct} % used | {pct} % इस्तेमाल |
| `dieLife.withLifeOnly` | Only copies with a life set | सिर्फ वे copy जिनकी लाइफ तय है |
| `dieLife.includeRetired` | Show retired copies | रिटायर copy भी दिखाएं |
| `dieLife.counts` | {withLife} of {copies} copies have a life set: {reached} reached, {near} near. | {copies} में से {withLife} copy की लाइफ तय है: {reached} पूरी, {near} पूरी होने वाली। |
| `dieLife.empty` | No die copies to show. | दिखाने के लिए कोई die copy नहीं। |
| `dieLife.csvName` | die-life | die-life |
| `dieLife.cardUsed` | Life: {pct} % used, {pressed} of {life} kg pressed | लाइफ: {pct} % इस्तेमाल, {life} kg में से {pressed} kg निकला |
| `dieLife.cardNoLife` | No life set for this copy. Pressed so far: {pressed} kg | इस copy की लाइफ तय नहीं। अब तक निकला: {pressed} kg |
| `dieLife.cardReached` | Life reached. Retire the copy or set a new life on the card. | लाइफ पूरी हो गई। copy रिटायर करें या कार्ड पर नई लाइफ डालें। |
| `stockAge.title` | Stock age | स्टॉक की उम्र |
| `stockAge.subtitle` | Available bundles in the yard by days since packing. Bundles held on a truck are left out. | यार्ड में पड़े available bundle, पैकिंग से कितने दिन हुए। ट्रक पर होल्ड bundle शामिल नहीं। |
| `stockAge.asOf` | Days counted to {date} | {date} तक के दिन |
| `stockAge.show` | Show | दिखाएं |
| `stockAge.all` | All stock | सारा स्टॉक |
| `stockAge.plantOnly` | Plant stock only | सिर्फ प्लांट स्टॉक |
| `stockAge.party` | Party | पार्टी |
| `stockAge.plantStock` | Plant stock | प्लांट स्टॉक |
| `stockAge.noName` | Party not found | पार्टी नहीं मिली |
| `stockAge.bucket0` | 0 to 7 days | 0 से 7 दिन |
| `stockAge.bucket1` | 8 to 30 days | 8 से 30 दिन |
| `stockAge.bucket2` | 31 to 90 days | 31 से 90 दिन |
| `stockAge.bucket3` | Over 90 days | 90 दिन से ज़्यादा |
| `stockAge.kg` | kg | kg |
| `stockAge.bundles` | Bundles | Bundle |
| `stockAge.bundleCount` | {count} {count:bundle\|bundles} | {count} bundle |
| `stockAge.chartTitle` | Stock by age | उम्र के हिसाब से स्टॉक |
| `stockAge.chartSubtitle` | Available kg in each age band | हर उम्र में available kg |
| `stockAge.chartLabel` | Available kg by age | उम्र के हिसाब से available kg |
| `stockAge.ageHeader` | Age | उम्र |
| `stockAge.kgHeader` | kg | kg |
| `stockAge.empty` | No available bundles in the yard. | यार्ड में कोई available bundle नहीं। |
| `stockAge.csvName` | stock-age | stock-age |
| `orders.title` | Order book report | ऑर्डर बुक रिपोर्ट |
| `orders.subtitle` | The order book summed by party or by order month. Open orders unless you pick another status; the total is the order book strip for the same filter. | पार्टी या ऑर्डर महीने के हिसाब से ऑर्डर बुक का जोड़। जब तक दूसरी स्थिति न चुनें, खुले ऑर्डर दिखते हैं; कुल वही है जो इसी फ़िल्टर पर ऑर्डर बुक की पट्टी में है। |
| `orders.groupBy` | Group by | किस हिसाब से |
| `orders.byParty` | By party | पार्टी के हिसाब से |
| `orders.byMonth` | By month | महीने के हिसाब से |
| `orders.party` | Party | पार्टी |
| `orders.month` | Order month | ऑर्डर महीना |
| `orders.allParties` | All parties | सभी पार्टी |
| `orders.status` | Status | स्थिति |
| `orders.allStatuses` | All orders | सभी ऑर्डर |
| `orders.statusOpen` | Open orders | खुले ऑर्डर |
| `orders.statusClosed` | Closed orders | बंद ऑर्डर |
| `orders.statusCancelled` | Cancelled orders | रद्द ऑर्डर |
| `orders.truncated` | Showing the first {count} parties. The total row counts every party. | पहली {count} पार्टी दिख रही हैं। कुल की पंक्ति में हर पार्टी गिनी गई है। |
| `orders.lateOnly` | Late orders only | सिर्फ लेट ऑर्डर |
| `orders.orders` | Orders | ऑर्डर |
| `orders.late` | Late | लेट |
| `orders.ordered` | Ordered kg | ऑर्डर kg |
| `orders.dispatched` | Dispatched kg | Dispatch kg |
| `orders.baki` | Baki kg | बाकी kg |
| `orders.dispatchedShare` | Dispatched % | Dispatch % |
| `orders.showRates` | Show rupees | रुपये दिखाएं |
| `orders.orderedValue` | Ordered Rs | ऑर्डर Rs |
| `orders.dispatchedValue` | Dispatched Rs | Dispatch Rs |
| `orders.bakiValue` | Baki Rs | बाकी Rs |
| `orders.rateMissing` | {count} {count:line has\|lines have} no rate; their kg count, their rupees do not. | {count} लाइन में रेट नहीं; उनका kg गिना है, रुपये नहीं। |
| `orders.empty` | No orders match. | कोई ऑर्डर नहीं मिला। |
| `orders.chartTitle` | Ordered kg by month | महीने के हिसाब से ऑर्डर kg |
| `orders.chartLabel` | Ordered kg per order month | हर ऑर्डर महीने का ऑर्डर kg |
| `orders.monthHeader` | Month | महीना |
| `orders.kgHeader` | kg | kg |
| `orders.csvName` | order-book | order-book |
| `todayTile.title` | Stock older than 90 days | 90 दिन से पुराना स्टॉक |
| `todayTile.meta` | {kg} kg in the yard | यार्ड में {kg} kg |

### errors (16)

| Key | English | हिंदी |
|---|---|---|
| `generic` | Something went wrong. Try again. | कुछ गड़बड़ हो गई। फिर से कोशिश करें। |
| `network` | No internet connection. Check it and try again. | इंटरनेट नहीं है। कनेक्शन जांचें और फिर से कोशिश करें। |
| `forbidden` | Your role can't do this. Ask an admin if you need it. | आपका रोल यह काम नहीं कर सकता। ज़रूरत हो तो एडमिन से कहें। |
| `notFound` | Not found | नहीं मिला |
| `notFoundInCompany` | Not found in this company | इस कंपनी में नहीं मिला |
| `sessionExpired` | Your session ended. Sign in again. | आपका सेशन खत्म हो गया। फिर से साइन इन करें। |
| `required` | Fill this in. | यह भरना ज़रूरी है। |
| `invalidNumber` | Enter a number, like 52.40. | नंबर डालें, जैसे 52.40 |
| `wholeNumber` | Enter a whole number. | पूरा नंबर डालें, दशमलव नहीं। |
| `notPositive` | Enter a number above 0. | 0 से बड़ा नंबर डालें। |
| `tooLong` | Keep this under {max} characters. | {max} अक्षरों से कम रखें। |
| `invalidEmail` | Enter an email like name@company.com. | ऐसा ईमेल डालें: name@company.com |
| `conflict` | Someone else changed this. Reload to see the latest. | किसी और ने इसे बदल दिया है। नया देखने के लिए पेज रीलोड करें। |
| `pageNotFound` | This page doesn't exist. | यह पेज मौजूद नहीं है। |
| `goToday` | Go to Today | आज का पेज खोलें |
| `printFailed` | The label didn't print: {reason} | लेबल प्रिंट नहीं हुआ: {reason} |

### labelSheet (13)

| Key | English | हिंदी |
|---|---|---|
| `title` | Label sheet | लेबल शीट |
| `subtitle` | Stickers for the browser to print on A4, for when no label printer is connected. | ब्राउज़र से A4 पर छापने के स्टिकर, जब कोई लेबल प्रिंटर जुड़ा न हो। |
| `print` | Print | प्रिंट करें |
| `perPage` | Stickers per page | हर पन्ने पर स्टिकर |
| `size10` | 10 per page | हर पन्ने पर 10 |
| `size21` | 21 per page | हर पन्ने पर 21 |
| `skip` | Stickers already used | पहले से इस्तेमाल हुए स्टिकर |
| `skipHint` | Start after the stickers already taken from this sheet. | इस शीट से जो स्टिकर पहले निकल चुके हैं, उनके बाद से शुरू करें। |
| `tip` | In the print window choose A4, scale 100%, and no headers or footers. | प्रिंट विंडो में A4, स्केल 100% चुनें और हेडर-फुटर बंद रखें। |
| `none` | No labels to print. Void bundles get none. | छापने के लिए कोई लेबल नहीं। Void bundle के लेबल नहीं बनते। |
| `page` | Page {n} of {total} | पन्ना {n} / {total} |
| `party` | Party {number} | पार्टी {number} |
| `cast` | Cast {cast} | कास्ट {cast} |

## Guides

### Pack a session and print labels (`pack-session`)

| Part | English | हिंदी |
|---|---|---|
| Title | Pack a session and print labels | पैकिंग सेशन करें और लेबल प्रिंट करें |
| When | Use this when bundles from one die are packed and you have each bundle's weight and piece count. | जब एक die के bundle पैक हो गए हों और हर bundle का वज़न और पीस आपके पास हों। |
| Step 1 | Start a session | सेशन शुरू करें |
| Step 1 text | Open "Pack" and tap "New packing session". | "पैकिंग" खोलें और "नया पैकिंग सेशन" दबाएं। |
| Step 2 | Choose the die | Die चुनें |
| Step 2 text | Search by die code or section. Dies you used recently are at the top. Archived dies don't show here. | Die कोड या सेक्शन से खोजें। हाल में इस्तेमाल हुए die सबसे ऊपर दिखते हैं। बंद die यहां नहीं दिखते। |
| Step 3 | Set cut length and PO | कट लंबाई और PO डालें |
| Step 3 text | Enter the cut length once for the whole session, and the PO if there is one. Every bundle uses these unless you change them on that bundle. | पूरे सेशन के लिए कट लंबाई एक बार डालें, और PO हो तो वो भी। हर bundle में यही लगेगा, जब तक आप उस bundle पर इसे न बदलें। |
| Step 4 | Enter each bundle | हर bundle डालें |
| Step 4 text | Type the weight in kg and press "Next". Type the pieces and press "Next" again. The bundle is added to the list and a new card opens. | kg में वज़न लिखें और "आगे" दबाएं। पीस लिखें और फिर "आगे" दबाएं। Bundle लिस्ट में जुड़ जाता है और नया कार्ड खुल जाता है। |
| Step 5 | Check the kg/12ft chip | kg/12ft वाला निशान देखें |
| Step 5 text | Green means the bundle is in the die's range. Amber means it is below or above. Check the weight and pieces before you carry on. | हरा मतलब bundle die की रेंज में है। पीला मतलब रेंज से कम या ज़्यादा है। आगे बढ़ने से पहले वज़न और पीस दोबारा जांचें। |
| Step 6 | Review and save | जांचें और सेव करें |
| Step 6 text | Tap "Review" and check the bundle count, pieces and kg. Then tap "Save and print labels". If label printing isn't set up, the button says "Save session". | "जांचें" दबाएं और bundle, पीस और kg का कुल देखें। फिर "सेव करें और लेबल प्रिंट करें" दबाएं। अगर लेबल प्रिंटिंग सेट नहीं है, तो बटन पर "सेशन सेव करें" लिखा होगा। |
| Problem 1 | One bundle has a different length or PO | किसी एक bundle की लंबाई या PO अलग है |
| Fix 1 | On that bundle's card, tap "Different length or PO" and enter it. The rest of the session keeps the defaults. | उस bundle के कार्ड पर "अलग लंबाई या PO" दबाएं और उसे डालें। बाकी सेशन में पहले वाली कट लंबाई और PO ही रहेंगे। |
| Problem 2 | I typed a wrong weight | गलत वज़न डाल दिया |
| Fix 2 | Before saving, tap the bundle's row to edit or remove it. After saving, void that bundle and pack it again. | सेव करने से पहले bundle की लाइन दबाकर उसे बदलें या हटाएं। सेव करने के बाद उस bundle को रद्द करें और फिर से पैक करें। |
| Problem 3 | Some labels didn't print | कुछ लेबल प्रिंट नहीं हुए |
| Fix 3 | The session is already saved. Tap "Retry failed labels", or open the session later and tap "Reprint" on each bundle. If it keeps failing, see "The printer isn't printing". | सेशन सेव हो चुका है। "फ़ेल हुए लेबल फिर से प्रिंट करें" दबाएं, या बाद में सेशन खोलकर हर bundle पर "फिर से प्रिंट करें" दबाएं। बार बार फ़ेल हो तो "प्रिंटर प्रिंट नहीं कर रहा" गाइड देखें। |

### Reprint a label (`reprint-label`)

| Part | English | हिंदी |
|---|---|---|
| Title | Reprint a label | लेबल फिर से प्रिंट करें |
| When | Use this when a bundle's label is torn, wet, unreadable or missing. | जब किसी bundle का लेबल फट गया हो, गीला हो गया हो, पढ़ा न जा रहा हो या गायब हो। |
| Step 1 | Find the bundle | Bundle ढूंढें |
| Step 1 text | Scan the old label if it still reads. If it doesn't, open "Stock", then "Bundles", and search the serial or PO. | पुराना लेबल पढ़ा जा रहा हो तो उसे स्कैन करें। नहीं तो "स्टॉक" खोलें, फिर "Bundle", और serial या PO से खोजें। |
| Step 2 | Check it's the right bundle | सही bundle है, यह पक्का करें |
| Step 2 text | Compare the serial, weight and pieces on screen with the bundle in front of you. | स्क्रीन पर दिख रहे serial, वज़न और पीस को सामने रखे bundle से मिलाएं। |
| Step 3 | Reprint | फिर से प्रिंट करें |
| Step 3 text | Tap "Reprint label". From a packing session you can also tap "Reprint" on one bundle, or "Print all labels" for the whole session. | "लेबल फिर से प्रिंट करें" दबाएं। पैकिंग सेशन से भी किसी एक bundle पर "फिर से प्रिंट करें" या पूरे सेशन के लिए "सारे लेबल प्रिंट करें" दबा सकते हैं। |
| Step 4 | Replace the label | लेबल बदलें |
| Step 4 text | Take the new label from the printer and put it on the bundle. Remove the old label so the bundle carries only one. | प्रिंटर से नया लेबल लें और bundle पर लगाएं। पुराना लेबल हटा दें, ताकि bundle पर एक ही लेबल रहे। |
| Problem 1 | There's no "Reprint" button | "फिर से प्रिंट करें" का बटन नहीं है |
| Fix 1 | Either your role can't print or label printing isn't set up for your company. Ask a manager. | या तो आपका रोल प्रिंट नहीं कर सकता, या आपकी कंपनी के लिए लेबल प्रिंटिंग सेट नहीं है। मैनेजर से पूछें। |
| Problem 2 | I can't find the bundle | Bundle नहीं मिल रहा |
| Fix 2 | Check the serial letter by letter. Serials look like BG-000001-B001. You can also search by PO. | Serial का हर अक्षर जांचें। Serial ऐसा दिखता है: BG-000001-B001। PO से भी खोज सकते हैं। |
| Problem 3 | The label came out blank or cut off | लेबल खाली निकला या कटा हुआ निकला |
| Fix 3 | See "The printer isn't printing". | "प्रिंटर प्रिंट नहीं कर रहा" गाइड देखें। |

### Scan and check a bundle (`scan-bundle`)

| Part | English | हिंदी |
|---|---|---|
| Title | Scan and check a bundle | Bundle स्कैन करके जांचें |
| When | Use this to see a bundle's details, status and dispatch from its label. | जब लेबल से किसी bundle की जानकारी, स्टेटस और dispatch देखनी हो। |
| Step 1 | Open Scan | स्कैन खोलें |
| Step 1 text | On a phone, tap "Scan" in the middle of the bottom bar. On a laptop, click "Scan or search", or press Ctrl+K (Cmd+K on a Mac). | फ़ोन पर नीचे वाली पट्टी के बीच में "स्कैन" दबाएं। लैपटॉप पर "स्कैन करें या खोजें" पर क्लिक करें, या Ctrl+K दबाएं (Mac पर Cmd+K)। |
| Step 2 | Allow the camera | कैमरा चालू करने दें |
| Step 2 text | The first time, orrn asks to use the camera. Allow it. orrn only uses it to read labels. | पहली बार orrn कैमरा इस्तेमाल करने की इजाज़त मांगेगा। इजाज़त दे दें। orrn कैमरे से सिर्फ़ लेबल पढ़ता है। |
| Step 3 | Point at the label | लेबल की तरफ़ कैमरा करें |
| Step 3 text | Hold the QR code or barcode inside the frame. In a dark spot, turn on the torch. | QR कोड या बारकोड को फ़्रेम के अंदर रखें। अंधेरी जगह पर टॉर्च चालू करें। |
| Step 4 | Read the result | नतीजा देखें |
| Step 4 text | The bundle opens. Green means "In stock", blue means "Held", red means "Void". A dispatched bundle shows which dispatch it went in. | Bundle खुल जाता है। हरा मतलब "स्टॉक में", नीला मतलब "होल्ड पर", लाल मतलब "रद्द"। Dispatch हो चुके bundle पर दिखता है कि वो किस dispatch में गया। |
| Step 5 | No camera, or a barcode gun | कैमरा नहीं है, या बारकोड गन है |
| Step 5 text | Type the serial in the box and press Enter. A barcode scanner on a laptop types into the same box. | बॉक्स में serial लिखें और Enter दबाएं। लैपटॉप पर बारकोड स्कैनर भी इसी बॉक्स में लिखता है। |
| Problem 1 | It says "Not found in this company" | "इस कंपनी में नहीं मिला" लिखा आया |
| Fix 1 | Check the serial you typed. If it's right, the label isn't from a bundle in your company. | जो serial लिखा है उसे जांचें। अगर वो सही है, तो यह लेबल आपकी कंपनी के किसी bundle का नहीं है। |
| Problem 2 | The camera is blocked | कैमरा बंद है |
| Fix 2 | Allow camera access in your browser or phone settings, then open "Scan" again. You can always type the serial instead. | ब्राउज़र या फ़ोन की सेटिंग में कैमरा चालू करें, फिर "स्कैन" दोबारा खोलें। Serial लिखकर भी हमेशा खोज सकते हैं। |
| Problem 3 | The camera won't read the label | कैमरा लेबल नहीं पढ़ रहा |
| Fix 3 | Wipe the label, move a little closer and turn on the torch. If the label is damaged, type the serial and reprint the label. | लेबल पोंछें, थोड़ा पास आएं और टॉर्च चालू करें। लेबल खराब हो तो serial लिखें और लेबल फिर से प्रिंट करें। |

### Build a dispatch by scanning (`build-dispatch`)

| Part | English | हिंदी |
|---|---|---|
| Title | Build a dispatch by scanning | स्कैन करके dispatch बनाएं |
| When | Use this to add bundles to a dispatch that is being built. | जब किसी बन रहे dispatch में bundle जोड़ने हों। |
| Step 1 | Open the dispatch | Dispatch खोलें |
| Step 1 text | Open "Dispatch", go to the "Building" tab and tap the dispatch. If it isn't there, ask the office to create it with "New dispatch". | "Dispatch" खोलें, "बन रहा है" टैब पर जाएं और dispatch दबाएं। अगर वो वहां नहीं है, तो ऑफ़िस से कहें कि "नया dispatch" से उसे बनाएं। |
| Step 2 | Start scanning | स्कैन शुरू करें |
| Step 2 text | Tap "Scan bundles". The camera stays open and adds each bundle you scan. | "Bundle स्कैन करें" दबाएं। कैमरा खुला रहता है और हर स्कैन किया bundle जोड़ता जाता है। |
| Step 3 | Scan each label | हर लेबल स्कैन करें |
| Step 3 text | Scan one label at a time. Each bundle that goes in shows up in the list and the count goes up. | एक बार में एक लेबल स्कैन करें। जो bundle जुड़ता है वो लिस्ट में दिखता है और गिनती बढ़ जाती है। |
| Step 4 | Read any warning | चेतावनी पढ़ें |
| Step 4 text | If a bundle is held for another dispatch, void or already dispatched, orrn says why and doesn't add it. Check with your manager before using that bundle. | अगर कोई bundle दूसरे dispatch के लिए होल्ड पर है, रद्द है या पहले ही dispatch हो चुका है, तो orrn कारण बताता है और उसे नहीं जोड़ता। उस bundle को इस्तेमाल करने से पहले मैनेजर से पूछें। |
| Step 5 | Have a list of serials instead? | Serial की लिस्ट है? |
| Step 5 text | Tap "Paste serials", paste them in and tap "Add bundles". orrn shows how many were added and why any were skipped. | "Serial पेस्ट करें" दबाएं, लिस्ट पेस्ट करें और "Bundle जोड़ें" दबाएं। orrn बताता है कितने जुड़े और कौन से क्यों छूटे। |
| Step 6 | Check the totals | कुल जांचें |
| Step 6 text | Tap "Done scanning". Bundles are grouped by section with a bundle count and kg for each group. Check them against the order. | "स्कैन बंद करें" दबाएं। Bundle सेक्शन के हिसाब से ग्रुप में दिखते हैं, हर ग्रुप की bundle गिनती और kg के साथ। इन्हें ऑर्डर से मिलाएं। |
| Problem 1 | It says "Already in this dispatch" | "इस dispatch में पहले से है" लिखा आया |
| Fix 1 | You scanned the same bundle twice. Nothing changed. Carry on with the next one. | आपने वही bundle दो बार स्कैन किया। कुछ नहीं बदला। अगला bundle स्कैन करें। |
| Problem 2 | A wrong bundle went in | गलत bundle जुड़ गया |
| Fix 2 | Tap the remove button on that bundle's row. | उस bundle की लाइन पर हटाने वाला बटन दबाएं। |
| Problem 3 | There's no "Scan bundles" button | "Bundle स्कैन करें" का बटन नहीं है |
| Fix 3 | The dispatch isn't in "Building" any more, or your role can't add bundles. Check the status at the top of the dispatch. | Dispatch अब "बन रहा है" में नहीं है, या आपका रोल bundle नहीं जोड़ सकता। Dispatch के ऊपर उसका स्टेटस देखें। |

### Hold stock, dispatch, and print the packing list (`hold-and-dispatch`)

| Part | English | हिंदी |
|---|---|---|
| Title | Hold stock, dispatch, and print the packing list | स्टॉक होल्ड करें, dispatch करें और पैकिंग लिस्ट प्रिंट करें |
| When | Use this when a dispatch has all its bundles and is ready to go. | जब किसी dispatch में सारे bundle आ गए हों और वो भेजने के लिए तैयार हो। |
| Step 1 | Check the dispatch | Dispatch जांचें |
| Step 1 text | Open the dispatch and check the customer, bundle count and kg at the top. | Dispatch खोलें और ऊपर ग्राहक, bundle की गिनती और kg देखें। |
| Step 2 | Hold stock | स्टॉक होल्ड करें |
| Step 2 text | Tap "Hold stock". Every bundle in the dispatch is held for it, so nobody can put them in another dispatch. Bundles added after this are held straight away. | "स्टॉक होल्ड करें" दबाएं। Dispatch के सारे bundle उसी के लिए होल्ड हो जाते हैं, कोई उन्हें दूसरे dispatch में नहीं डाल सकता। इसके बाद जोड़े गए bundle तुरंत होल्ड हो जाते हैं। |
| Step 3 | Release if plans change | प्लान बदले तो होल्ड हटाएं |
| Step 3 text | Tap "Release" to send the dispatch back to "Building". Its bundles go back in stock until you hold again. | "होल्ड हटाएं" दबाने से dispatch वापस "बन रहा है" में चला जाता है। दोबारा होल्ड करने तक इसके bundle फिर से स्टॉक में रहते हैं। |
| Step 4 | Dispatch | Dispatch करें |
| Step 4 text | When the bundles are ready to leave, tap "Dispatch", check the totals and confirm. After this, bundles can't be added or removed. | जब bundle निकलने के लिए तैयार हों, "Dispatch करें" दबाएं, कुल जांचें और पक्का करें। इसके बाद bundle जोड़ या हटा नहीं सकते। |
| Step 5 | Get the packing list | पैकिंग लिस्ट लें |
| Step 5 text | The packing list opens. Tap "Download PDF" to print it, or "Download Excel" for the office. On the phone app, tap "Share" to send it. | पैकिंग लिस्ट खुल जाती है। प्रिंट के लिए "PDF डाउनलोड करें" दबाएं, या ऑफ़िस के लिए "Excel डाउनलोड करें"। फ़ोन ऐप में भेजने के लिए "शेयर करें" दबाएं। |
| Problem 1 | I don't see "Hold stock" or "Dispatch" | "स्टॉक होल्ड करें" या "Dispatch करें" नहीं दिख रहा |
| Fix 1 | Only managers, admins and owners can hold and dispatch. Ask one of them. | होल्ड और dispatch सिर्फ़ मैनेजर, एडमिन और मालिक कर सकते हैं। उनमें से किसी से कहें। |
| Problem 2 | The dispatch has to be stopped | Dispatch रोकना है |
| Fix 2 | Open "More actions" and tap "Cancel dispatch". Held bundles go back to stock. A dispatch that is already "Dispatched" can't be cancelled. | "और विकल्प" खोलें और "Dispatch कैंसल करें" दबाएं। होल्ड वाले bundle वापस स्टॉक में चले जाते हैं। जो dispatch हो चुका है, वो कैंसल नहीं होता। |
| Problem 3 | A number on the packing list looks wrong | पैकिंग लिस्ट में कोई नंबर गलत लग रहा है |
| Fix 3 | A manager can tap "Regenerate" to build the packing list again from the bundles as they are now. | मैनेजर "फिर से बनाएं" दबाकर bundle की अभी की जानकारी से पैकिंग लिस्ट दोबारा बना सकता है। |

### Void or restore a bundle (`void-bundle`)

| Part | English | हिंदी |
|---|---|---|
| Title | Void or restore a bundle | Bundle रद्द करें या वापस लाएं |
| When | Use this when a bundle should not be sold as entered, for example it was packed twice or has the wrong weight. | जब कोई bundle जैसा डाला गया है वैसा बेचा नहीं जाना चाहिए, जैसे दो बार पैक हो गया या वज़न गलत डला। |
| Step 1 | Open the bundle | Bundle खोलें |
| Step 1 text | Scan its label, or open "Stock", then "Bundles", and search the serial. | उसका लेबल स्कैन करें, या "स्टॉक" खोलें, फिर "Bundle", और serial खोजें। |
| Step 2 | Check the status | स्टेटस देखें |
| Step 2 text | Only a bundle that is "In stock" can be voided. If it is "Held", it has to come out of its dispatch first. Ask a manager. | सिर्फ़ "स्टॉक में" वाला bundle रद्द हो सकता है। अगर वो "होल्ड पर" है, तो पहले उसे उसके dispatch से निकालना होगा। मैनेजर से कहें। |
| Step 3 | Void it | रद्द करें |
| Step 3 text | Tap "Void bundle", write the reason and confirm. The bundle turns red and can't go into a dispatch. | "Bundle रद्द करें" दबाएं, कारण लिखें और पक्का करें। Bundle लाल हो जाता है और किसी dispatch में नहीं जा सकता। |
| Step 4 | Restore it if needed | ज़रूरत हो तो वापस लाएं |
| Step 4 text | If the void was a mistake, open the bundle, tap "Restore bundle" and give a reason. It goes back to "In stock". | अगर गलती से रद्द हुआ, तो bundle खोलें, "Bundle वापस लाएं" दबाएं और कारण लिखें। वो फिर से "स्टॉक में" आ जाता है। |
| Step 5 | Check the history | इतिहास देखें |
| Step 5 text | The "History" list on the bundle shows each change, who made it and the reason. | Bundle पर "इतिहास" में हर बदलाव दिखता है, किसने किया और क्या कारण था। |
| Problem 1 | There's no "Void bundle" button | "Bundle रद्द करें" का बटन नहीं है |
| Fix 1 | Either the bundle isn't "In stock", or your role can't change bundle status. Ask a manager. | या तो bundle "स्टॉक में" नहीं है, या आपका रोल bundle का स्टेटस नहीं बदल सकता। मैनेजर से पूछें। |
| Problem 2 | I voided the wrong bundle | गलत bundle रद्द कर दिया |
| Fix 2 | Restore it straight away with a reason. The history keeps both changes. | तुरंत कारण लिखकर उसे वापस लाएं। इतिहास में दोनों बदलाव दर्ज रहते हैं। |

### Add or edit a die (`edit-die`)

| Part | English | हिंदी |
|---|---|---|
| Title | Add or edit a die | Die जोड़ें या बदलें |
| When | Use this when a new die arrives or a die's details change. | जब नया die आए या किसी die की जानकारी बदले। |
| Step 1 | Open Dies | Die खोलें |
| Step 1 text | Open "More", then "Dies". Tap "New die". To change a die, open it and tap "Edit die". | "और" खोलें, फिर "Die"। "नया die" दबाएं। किसी die को बदलने के लिए उसे खोलें और "Die बदलें" दबाएं। |
| Step 2 | Enter the code | कोड डालें |
| Step 2 text | Fill in the series, section code and name. The floor sees the section code when picking a die in Pack. | सीरीज़, सेक्शन कोड और नाम भरें। पैकिंग में die चुनते समय फ़्लोर को सेक्शन कोड ही दिखता है। |
| Step 3 | Set the weight range | वज़न रेंज डालें |
| Step 3 text | Enter the min and max weight in kg for one 12 ft length. Pack uses this range for the green or amber kg/12ft chip. | 12 ft लंबाई का कम से कम और ज़्यादा से ज़्यादा वज़न kg में डालें। पैकिंग में kg/12ft का हरा या पीला निशान इसी रेंज से आता है। |
| Step 4 | Set the status | स्टेटस चुनें |
| Step 4 text | "Active" dies show in Pack. "Archived" dies are hidden from Pack but keep all their bundles and history. | "चालू" die पैकिंग में दिखते हैं। "बंद" die पैकिंग में नहीं दिखते, पर उनके सारे bundle और इतिहास रहते हैं। |
| Step 5 | Add measurements if you have them | नाप हों तो डालें |
| Step 5 text | Width, thickness, oblique and leg are under "Advanced". They are optional. | चौड़ाई, मोटाई, oblique और लेग "एडवांस" में हैं। ये ज़रूरी नहीं हैं। |
| Step 6 | Save | सेव करें |
| Step 6 text | Tap "Save die". The die's page opens with its weight band and measurements. | "Die सेव करें" दबाएं। Die का पेज खुलेगा, उस पर वज़न की रेंज और नाप दिखते हैं। |
| Problem 1 | It says the code belongs to a deleted die | लिखा आया कि कोड एक डिलीट हुए die का है |
| Fix 1 | That code was used by a die that was deleted. Use a different code. | यह कोड पहले एक die का था जो डिलीट हो चुका है। दूसरा कोड डालें। |
| Problem 2 | I have many dies to add | बहुत सारे die जोड़ने हैं |
| Fix 2 | Use "Import CSV" from the menu on the Dies list. Owners and admins can also import from "Settings", then "Data". | Die की लिस्ट के मेन्यू से "CSV इम्पोर्ट करें" इस्तेमाल करें। मालिक और एडमिन "सेटिंग्स" में "डेटा" से भी इम्पोर्ट कर सकते हैं। |
| Problem 3 | I can't edit dies | Die बदल नहीं पा रहे |
| Fix 3 | Only managers, admins and owners can add or change dies. | Die सिर्फ़ मैनेजर, एडमिन और मालिक जोड़ या बदल सकते हैं। |

### Add a customer (`add-customer`)

| Part | English | हिंदी |
|---|---|---|
| Title | Add a customer | ग्राहक जोड़ें |
| When | Use this before the first dispatch to a new customer. | किसी नए ग्राहक के पहले dispatch से पहले। |
| Step 1 | Open Customers | ग्राहक खोलें |
| Step 1 text | Open "More", then "Customers", and tap "New customer". You can also tap "New customer" while creating a dispatch. | "और" खोलें, फिर "ग्राहक", और "नया ग्राहक" दबाएं। Dispatch बनाते समय भी "नया ग्राहक" दबा सकते हैं। |
| Step 2 | Name and contact | नाम और संपर्क |
| Step 2 text | Enter the name as it should print on the packing list, then the phone and email. | नाम वैसा लिखें जैसा पैकिंग लिस्ट पर छपना चाहिए, फिर फ़ोन और ईमेल। |
| Step 3 | GSTIN | GSTIN |
| Step 3 text | Enter the 15-character GSTIN if the customer has one. | ग्राहक का GSTIN हो तो 15 अक्षर का GSTIN डालें। |
| Step 4 | Addresses | पता |
| Step 4 text | Enter the billing address. If goods go to the same place, tick "Same as billing address". If not, fill in the shipping address. | बिलिंग का पता डालें। अगर माल उसी जगह जाता है, तो "बिलिंग वाला पता ही" पर टिक करें। नहीं तो डिलीवरी का पता भरें। |
| Step 5 | Save | सेव करें |
| Step 5 text | Tap "Save customer". The customer's page opens; it lists every dispatch to them, and "Edit customer" changes the details later. | "ग्राहक सेव करें" दबाएं। ग्राहक का पेज खुलेगा; उस पर इस ग्राहक के सारे dispatch दिखते हैं, और बाद में "ग्राहक बदलें" से जानकारी बदल सकते हैं। |
| Problem 1 | The customer may already exist | शायद ग्राहक पहले से है |
| Fix 1 | Search the list by name, phone or GSTIN before adding, so the same customer isn't added twice. | जोड़ने से पहले लिस्ट में नाम, फ़ोन या GSTIN से खोज लें, ताकि एक ही ग्राहक दो बार न जुड़े। |
| Problem 2 | I can't add customers | ग्राहक नहीं जोड़ पा रहे |
| Fix 2 | Only managers, admins and owners can add or change customers. | ग्राहक सिर्फ़ मैनेजर, एडमिन और मालिक जोड़ या बदल सकते हैं। |

### Invite a team member and choose a role (`invite-member`)

| Part | English | हिंदी |
|---|---|---|
| Title | Invite a team member and choose a role | टीम में किसी को इनवाइट करें और रोल चुनें |
| When | Use this when someone new needs to use orrn for your company. | जब कोई नया व्यक्ति आपकी कंपनी के लिए orrn इस्तेमाल करेगा। |
| Step 1 | Open Team | टीम खोलें |
| Step 1 text | Open "Settings" and go to the "Team" tab. | "सेटिंग्स" खोलें और "टीम" टैब पर जाएं। |
| Step 2 | Enter their email | उनका ईमेल डालें |
| Step 2 text | Tap "Invite member" and type the email they will sign in with. | "सदस्य को इनवाइट करें" दबाएं और वो ईमेल लिखें जिससे वे साइन इन करेंगे। |
| Step 3 | Choose a role | रोल चुनें |
| Step 3 text | "Operator" for floor staff who pack, scan and print labels. "Manager" for staff who also run dispatches, dies, customers and printers. "Viewer" for people who only need to look. "Admin" for people who also manage the team and settings. | "ऑपरेटर" फ़्लोर स्टाफ़ के लिए जो पैक, स्कैन और लेबल प्रिंट करते हैं। "मैनेजर" उनके लिए जो dispatch, die, ग्राहक और प्रिंटर भी संभालते हैं। "व्यूअर" उनके लिए जिन्हें सिर्फ़ देखना है। "एडमिन" उनके लिए जो टीम और सेटिंग्स भी संभालते हैं। |
| Step 4 | Send the invite | इनवाइट भेजें |
| Step 4 text | Tap "Send invite". They get an email with a link that works for 7 days. | "इनवाइट भेजें" दबाएं। उन्हें एक ईमेल मिलेगा जिसका लिंक 7 दिन तक चलता है। |
| Step 5 | They join | वे जुड़ जाते हैं |
| Step 5 text | They open the link, enter their name and a password, and they are in. | वे लिंक खोलकर अपना नाम और पासवर्ड डालते हैं, और orrn में आ जाते हैं। |
| Step 6 | Change or remove later | बाद में बदलें या हटाएं |
| Step 6 text | From the Team list you can change a member's role or remove them. Only an owner can change another owner. | टीम की लिस्ट से किसी का रोल बदल सकते हैं या उसे हटा सकते हैं। मालिक का रोल सिर्फ़ दूसरा मालिक बदल सकता है। |
| Problem 1 | The email didn't arrive | ईमेल नहीं आया |
| Fix 1 | Ask them to check spam. If it isn't there, check the email address, cancel the invite and send a new one. | उनसे स्पैम फ़ोल्डर देखने को कहें। वहां भी न हो तो ईमेल पता जांचें, पुराना इनवाइट कैंसल करें और नया भेजें। |
| Problem 2 | The link has expired | लिंक पुराना हो गया |
| Fix 2 | Links work for 7 days. Cancel the old invite and send a new one. | लिंक 7 दिन चलता है। पुराना इनवाइट कैंसल करें और नया भेजें। |
| Problem 3 | I gave the wrong role | गलत रोल दे दिया |
| Fix 3 | Change it from the Team list. | टीम की लिस्ट से उसे बदल दें। |

### The printer isn't printing (`printer-trouble`)

| Part | English | हिंदी |
|---|---|---|
| Title | The printer isn't printing | प्रिंटर प्रिंट नहीं कर रहा |
| When | Use this when labels don't come out, come out blank, or the queue shows failed jobs. | जब लेबल नहीं निकल रहे, खाली निकल रहे हैं, या कतार में फ़ेल जॉब दिख रहे हैं। |
| Step 1 | Check the queue | कतार देखें |
| Step 1 text | Open "Printing" and look at the "Queue" tab. A failed job shows "Failed" and the reason. | "प्रिंटिंग" खोलें और "कतार" टैब देखें। फ़ेल जॉब पर "फ़ेल" और उसका कारण दिखता है। |
| Step 2 | Check the printer | प्रिंटर देखें |
| Step 2 text | Open the "Printers" tab. If the printer shows "Offline", check it is switched on, has labels loaded and its cable is connected. | "प्रिंटर" टैब खोलें। अगर प्रिंटर "ऑफ़लाइन" दिखे, तो देखें कि वो चालू है, उसमें लेबल लगे हैं और उसकी केबल जुड़ी है। |
| Step 3 | Check label printing | लेबल प्रिंटिंग देखें |
| Step 3 text | If every printer is "Offline", open "Settings", then "Printing". If it says "Not connected", the plant computer that sends labels to the printers is off or has no internet. Ask whoever looks after it to restart it. | अगर सारे प्रिंटर "ऑफ़लाइन" हैं, तो "सेटिंग्स" खोलें, फिर "प्रिंटिंग"। अगर वहां "जुड़ा नहीं है" लिखा है, तो प्लांट का वो कंप्यूटर जो प्रिंटर को लेबल भेजता है, बंद है या उसमें इंटरनेट नहीं है। जो उसे संभालता है, उससे उसे रीस्टार्ट करने को कहें। |
| Step 4 | Retry the job | जॉब फिर से भेजें |
| Step 4 text | Once the printer is back, a manager taps "Retry" on the failed job in the "Queue" tab. You can also reprint from the bundle or the packing session. | प्रिंटर चालू होने पर मैनेजर "कतार" टैब में फ़ेल जॉब पर "फिर से भेजें" दबाता है। Bundle या पैकिंग सेशन से भी फिर से प्रिंट कर सकते हैं। |
| Step 5 | Still stuck | फिर भी नहीं हुआ |
| Step 5 text | Note the reason shown on the failed job and send it to the orrn team. | फ़ेल जॉब पर लिखा कारण नोट करें और orrn टीम को भेजें। |
| Problem 1 | Labels come out blank | लेबल खाली निकल रहे हैं |
| Fix 1 | Check the label roll is loaded the right way round. If it still happens, ask a manager to tap "Send label design to printers" on the "Labels" tab. | देखें कि लेबल रोल सही तरफ़ से लगा है। फिर भी हो तो मैनेजर से "लेबल" टैब पर "लेबल डिज़ाइन प्रिंटर को भेजें" दबाने को कहें। |
| Problem 2 | It says "Label printing isn't set up" | "लेबल प्रिंटिंग सेट नहीं है" लिखा आया |
| Fix 2 | Label printing hasn't been set up for your company yet. Ask the orrn team. | आपकी कंपनी के लिए लेबल प्रिंटिंग अभी सेट नहीं हुई है। orrn टीम से कहें। |
| Problem 3 | There's no "Retry" button | "फिर से भेजें" का बटन नहीं है |
| Fix 3 | Only managers, admins and owners can retry or cancel jobs. Ask one of them. | जॉब फिर से भेजना या कैंसल करना सिर्फ़ मैनेजर, एडमिन और मालिक कर सकते हैं। उनमें से किसी से कहें। |

### Weigh a scrap lot (`weigh-scrap-lot`)

| Part | English | हिंदी |
|---|---|---|
| Title | Weigh a scrap lot | स्क्रैप लॉट तौलें |
| When | Use this when a scrap truck comes to the kanta. | जब स्क्रैप की गाड़ी कांटे पर आए। |
| Step 1 | Start the lot | लॉट शुरू करें |
| Step 1 text | Open "Purchase" and tap "New lot". | "खरीद" खोलें और "नया लॉट" दबाएं। |
| Step 2 | Pick the vendor | पार्टी चुनें |
| Step 2 text | Search by the name on the slip. Any spelling the book uses finds the same vendor. For a new party, tap "Add new vendor". A manager confirms it later. | पर्ची पर लिखे नाम से खोजें। बुक में लिखा कोई भी नाम उसी पार्टी को ढूंढ लेता है। नई पार्टी के लिए "नई पार्टी जोड़ें" दबाएं। मैनेजर उसे बाद में पक्का करेंगे। |
| Step 3 | Material and rate | माल और रेट |
| Step 3 text | Choose the material and the grade, and type the rate per kg. The vendor's usual material and last rate are one tap away. | माल और ग्रेड चुनें, और प्रति kg रेट लिखें। पार्टी का आम माल और पिछला रेट एक टैप पर मिलता है। |
| Step 4 | Enter both weights | दोनों वज़न डालें |
| Step 4 text | Type the weight on the party's slip, then our kanta weight. The difference and the tolerance show straight away. If the truck is not weighed here yet, leave our kanta empty and add it later with "Edit weights". | पार्टी की पर्ची का वज़न लिखें, फिर हमारे कांटे का वज़न। फ़र्क और छूट तुरंत दिखते हैं। गाड़ी यहां अभी नहीं तौली तो हमारा कांटा खाली छोड़ें और बाद में "वज़न बदलें" से डालें। |
| Step 5 | Short beyond the tolerance | छूट से ज़्यादा कमी |
| Step 5 text | If the lot is short beyond the tolerance, the office raises the debit note on the same screen: keep "Raise the debit note now" on and check the kg. A manager approves it in "Approvals". | अगर लॉट छूट से ज़्यादा कम है, तो ऑफ़िस उसी स्क्रीन पर डेबिट नोट बनाता है: "डेबिट नोट अभी बनाएं" चालू रखें और kg जांच लें। मैनेजर इसे "मंज़ूरी" में मंज़ूर करते हैं। |
| Step 6 | Save and mark OK | सेव करें और OK करें |
| Step 6 text | Tap "Save lot". When the truck is unloaded, open the lot and tap "Mark OK". The scrap goes into scrap stock. | "लॉट सेव करें" दबाएं। गाड़ी उतर जाए तो लॉट खोलें और "OK करें" दबाएं। स्क्रैप, स्क्रैप स्टॉक में चला जाता है। |
| Problem 1 | There is no "Mark OK" button | "OK करें" का बटन नहीं है |
| Fix 1 | Either our kanta weight is missing, or the lot is short beyond the tolerance and no debit note covers it. The lot page says which. | या तो हमारे कांटे का वज़न नहीं डाला, या लॉट छूट से ज़्यादा कम है और कोई डेबिट नोट उसे नहीं ढकता। लॉट के पेज पर वजह लिखी है। |
| Problem 2 | I typed a wrong weight | गलत वज़न डल गया |
| Fix 2 | Open the lot and tap "Edit weights" before it is OK. Once a note on the weight is open the weights are locked, so ask the manager to reject that note first. | OK होने से पहले लॉट खोलें और "वज़न बदलें" दबाएं। वज़न पर नोट खुला हो तो वज़न बंद रहता है, इसलिए पहले मैनेजर से वह नोट नामंज़ूर करवाएं। |
| Problem 3 | The same vendor shows up twice | एक ही पार्टी दो बार दिखती है |
| Fix 3 | A manager merges the two vendors in Masters. Their lots move with the merge. | मैनेजर Masters में दोनों पार्टियों को मिला देते हैं। उनके लॉट भी साथ चले जाते हैं। |

### Issue and receive store items (`store-entries`)

| Part | English | हिंदी |
|---|---|---|
| Title | Issue and receive store items | स्टोर से माल दें और माल लें |
| When | Use this when chemicals, fuel, gas or spares leave the store or a delivery comes in. | जब केमिकल, ईंधन, गैस या स्पेयर स्टोर से बाहर जाएं या कोई डिलीवरी आए। |
| Step 1 | Open the store | स्टोर खोलें |
| Step 1 text | Open "Store". Every item shows how much is in the store now. | "स्टोर" खोलें। हर सामान के आगे दिखता है कि अभी स्टोर में कितना है। |
| Step 2 | Issue to the floor | फ़्लोर को माल दें |
| Step 2 text | Tap "Issue", pick the item, type the quantity and choose what it is for. Tap "Issue" again to save. The MRS number shows on screen. | "माल दें" दबाएं, सामान चुनें, मात्रा लिखें और किस काम के लिए है वो चुनें। सेव करने के लिए फिर से "माल दें" दबाएं। स्क्रीन पर MRS नंबर दिखेगा। |
| Step 3 | Receive a delivery | डिलीवरी लें |
| Step 3 text | Tap "Receive", pick the item, type the quantity from the challan and add the challan or bill number. Tap "Receive" again to save. The GRN number shows on screen. | "माल लें" दबाएं, सामान चुनें, चालान से मात्रा लिखें और चालान या बिल नंबर डालें। सेव करने के लिए फिर से "माल लें" दबाएं। स्क्रीन पर GRN नंबर दिखेगा। |
| Step 4 | Exchange old for new | पुराना देकर नया लें |
| Step 4 text | When an old part leaves the store and a new one comes in, tap "Exchange". Type how many go out and how many come in. | जब पुराना पार्ट स्टोर से बाहर जाए और नया अंदर आए, तो "पुराना देकर नया" दबाएं। कितने बाहर गए और कितने अंदर आए, लिखें। |
| Step 5 | Check an item | सामान देखें |
| Step 5 text | Tap an item in the list to see its balance and every entry for it. | लिस्ट में किसी सामान पर दबाएं, उसका बैलेंस और उसकी हर एंट्री दिखेगी। |
| Problem 1 | It says there is not enough in the store | लिखा आया कि स्टोर में इतना नहीं है |
| Fix 1 | You typed more than the store holds. Issue less, or receive the delivery first and then issue. | आपने स्टोर में जितना है उससे ज़्यादा लिखा है। कम दें, या पहले डिलीवरी लें और फिर दें। |
| Problem 2 | I saved a wrong quantity | गलत मात्रा सेव हो गई |
| Fix 2 | Open the entry, tap "Cancel entry" and write why. Then make the entry again with the right quantity. | एंट्री खोलें, "एंट्री रद्द करें" दबाएं और वजह लिखें। फिर सही मात्रा से नई एंट्री करें। |
| Problem 3 | The item is not in the list | सामान लिस्ट में नहीं है |
| Fix 3 | Open "Store items" and tap "Add item". Choose its unit carefully: it can't change after the first entry. | "स्टोर का सामान" खोलें और "सामान जोड़ें" दबाएं। इकाई ध्यान से चुनें: पहली एंट्री के बाद यह नहीं बदल सकती। |

### Check stock by die (`stock-by-die`)

| Part | English | हिंदी |
|---|---|---|
| Title | Check stock by die | Die के हिसाब से स्टॉक देखें |
| When | Use this to see how many bundles and how many kg of one die are in stock or held. | जब आपको देखना हो कि एक die के कितने bundle और कितने kg स्टॉक में या होल्ड पर हैं। |
| Step 1 | Open Stock | स्टॉक खोलें |
| Step 1 text | Open "Stock". The "Sections" view lists one block for each die section that has bundles on the floor. | "स्टॉक" खोलें। "सेक्शन" व्यू में हर उस die सेक्शन का एक ब्लॉक दिखता है जिसके bundle फ़्लोर पर हैं। |
| Step 2 | Find the die | Die खोजें |
| Step 2 text | Type the die or section code in "Search die or section". The list narrows as you type. | "Die या सेक्शन खोजें" में die या सेक्शन का कोड लिखें। लिखते-लिखते लिस्ट छोटी होती जाती है। |
| Step 3 | Read the block | ब्लॉक पढ़ें |
| Step 3 text | Each block shows the bundles in stock, the bundles held for a dispatch, the kg and the kg/12ft weight range. Held bundles are counted apart from the ones in stock. | हर ब्लॉक में स्टॉक वाले bundle, dispatch के लिए होल्ड वाले bundle, kg और kg/12ft की वज़न रेंज दिखती है। होल्ड वाले bundle स्टॉक वालों से अलग गिने जाते हैं। |
| Step 4 | Open the section | सेक्शन खोलें |
| Step 4 text | Tap the block to see its bundles. Use "Status" to show "In stock", "Held" or "Dispatched" bundles. | उसके bundle देखने के लिए ब्लॉक दबाएं। "स्टेटस" से "स्टॉक में", "होल्ड पर" या "Dispatch हो गया" वाले bundle छांटें। |
| Step 5 | Open one bundle | एक bundle खोलें |
| Step 5 text | Tap a bundle to see its weight, pieces, cut length and history. For the die's own details, tap "Die details". | किसी bundle को दबाकर उसका वज़न, पीस, कट लंबाई और इतिहास देखें। Die की अपनी जानकारी के लिए "Die की जानकारी" दबाएं। |
| Problem 1 | The die isn't in the list | Die लिस्ट में नहीं है |
| Fix 1 | Only sections with bundles on the floor show here. If the die was packed recently, tap "Clear search" and check the spelling of the code. Dispatched or void bundles are not counted as stock. | यहां सिर्फ़ वही सेक्शन दिखते हैं जिनके bundle फ़्लोर पर हैं। Die हाल में पैक हुआ हो तो "खोज हटाएं" दबाएं और कोड की स्पेलिंग जांचें। Dispatch हो चुके या रद्द bundle स्टॉक में नहीं गिने जाते। |
| Problem 2 | The count doesn't match the yard | गिनती यार्ड से नहीं मिलती |
| Fix 2 | The screen shows what orrn has recorded, so unrecorded packing and dispatch change it. Do a count before you adjust anything. See "Count the stock". | स्क्रीन वही दिखाती है जो orrn में दर्ज है, इसलिए दर्ज न हुई पैकिंग या dispatch से फ़र्क आता है। कुछ बदलने से पहले गिनती करें। "स्टॉक की गिनती करें" देखें। |

### Count the stock (`stock-count`)

| Part | English | हिंदी |
|---|---|---|
| Title | Count the stock | स्टॉक की गिनती करें |
| When | Use this for a physical count: every bundle in the yard is checked against what orrn holds, yard by yard. | असली गिनती के लिए, जब यार्ड का हर bundle orrn में दर्ज स्टॉक से यार्ड-दर-यार्ड मिलाया जाता है। |
| Step 1 | Stop packing and dispatch | पैकिंग और dispatch रोकें |
| Step 1 text | Tell the packers and the dispatch team to stop before the count starts. A bundle packed or sent out during the count will show as a mistake. | गिनती शुरू होने से पहले पैकर और dispatch वालों को काम रोकने को कहें। गिनती के दौरान पैक हुआ या बाहर गया bundle गलती की तरह दिखेगा। |
| Step 2 | Start the count | गिनती शुरू करें |
| Step 2 text | Open Stock, then "Stock count". Tick the yards you will count and press "Start a count". A count over every yard also checks bundles that have no yard. | Stock खोलें, फिर "स्टॉक की गिनती"। जो यार्ड गिनने हैं उन पर निशान लगाएं और "गिनती शुरू करें" दबाएं। सारे यार्ड की गिनती में बिना यार्ड वाले bundle भी जांचे जाते हैं। |
| Step 3 | Scan every bundle | हर bundle स्कैन करें |
| Step 3 text | Pick the yard you are standing in, then scan each bundle's QR label. You can also type the printed bundle number, or press "Paste codes" to count a whole list. orrn answers each code at once. | जिस यार्ड में खड़े हैं वह चुनें, फिर हर bundle का QR लेबल स्कैन करें। छपा हुआ bundle नंबर भी लिख सकते हैं, या पूरी लिस्ट गिनने के लिए "कोड पेस्ट करें" दबाएं। orrn हर कोड का जवाब तुरंत देता है। |
| Step 4 | Read the answers | जवाब पढ़ें |
| Step 4 text | Here means orrn agrees. Moved, Elsewhere and Not in stock mean orrn holds the bundle somewhere else or not at all. Unknown code means orrn has never seen that number. Leave those bundles where they are and note them. | यहीं है मतलब orrn सहमत है। खिसका हुआ, कहीं और और स्टॉक में नहीं का मतलब है कि orrn में bundle कहीं और है या है ही नहीं। पहचाना नहीं गया मतलब वह नंबर orrn ने कभी देखा नहीं। ऐसे bundle को वहीं रहने दें और नोट बनाएं। |
| Step 5 | Chase what's missing | जो नहीं मिला उसे ढूंढें |
| Step 5 text | Before you close, the missing list shows every bundle orrn has in your yards that nobody scanned. Look again in the nearby yards before you give up on a bundle. | बंद करने से पहले, गायब की लिस्ट में आपके यार्ड के वे सारे bundle दिखते हैं जो orrn में हैं पर किसी ने स्कैन नहीं किए। किसी bundle को छोड़ने से पहले आसपास के यार्ड में दोबारा देखें। |
| Step 6 | Close and read the report | बंद करें और रिपोर्ट पढ़ें |
| Step 6 text | Press "Close count". The report shows what is missing, what was found out of place, and the difference by yard and by section. Closing does not change the stock: a manager decides what to void. | "गिनती बंद करें" दबाएं। रिपोर्ट में दिखता है क्या गायब है, क्या गलत जगह मिला, और यार्ड व सेक्शन के हिसाब से फ़र्क। बंद करने से स्टॉक नहीं बदलता: क्या void करना है, यह मैनेजर तय करता है। |
| Problem 1 | A bundle has no QR label | Bundle पर QR लेबल नहीं है |
| Fix 1 | Type the bundle number printed on it. If the number is unreadable too, put the bundle aside and give it to the manager. | उस पर छपा bundle नंबर लिखें। नंबर भी पढ़ा न जाए तो bundle को अलग रखें और मैनेजर को दें। |
| Problem 2 | Many bundles are not found | बहुत सारे bundle नहीं मिल रहे |
| Fix 2 | Do not adjust anything yet. Check that the count did not start before the last dispatch was recorded. Most gaps come from the tail of a production run that was never marked as sent. | अभी कुछ न बदलें। देखें कि गिनती आखिरी dispatch दर्ज होने से पहले तो शुरू नहीं हो गई। ज़्यादातर कमी उस प्रोडक्शन रन की बची हुई पूंछ से आती है जिसे कभी भेजा हुआ दर्ज नहीं किया गया। |
| Problem 3 | The count was interrupted | गिनती बीच में रुक गई |
| Fix 3 | Your scans stay in the count. Open it again from the list of counts in progress and carry on. | आपके स्कैन गिनती में बने रहते हैं। चल रही गिनतियों की लिस्ट से उसे फिर खोलें और आगे बढ़ें। |

### Approve an access request (`approve-access-request`)

| Part | English | हिंदी |
|---|---|---|
| Title | Approve an access request | एक्सेस रिक्वेस्ट मंज़ूर करें |
| When | Use this when a plant has asked for access on the website and orrn support has to set up its company. | जब किसी प्लांट ने वेबसाइट पर एक्सेस मांगा हो और orrn सपोर्ट को उसकी कंपनी सेट करनी हो। |
| Step 1 | Open the requests | रिक्वेस्ट खोलें |
| Step 1 text | Sign in to Godseye and open "Access requests". Requests that are waiting are at the top. | Godseye में साइन इन करें और "एक्सेस रिक्वेस्ट" खोलें। जो रिक्वेस्ट बाकी हैं वो सबसे ऊपर होती हैं। |
| Step 2 | Read the request | रिक्वेस्ट पढ़ें |
| Step 2 text | Check the company name, the contact's name and work email, the number of extrusion lines and the notes. If anything looks wrong, call the contact before you approve. | कंपनी का नाम, संपर्क का नाम और काम का ईमेल, एक्सट्रूज़न लाइनों की गिनती और नोट्स जांचें। कुछ ठीक न लगे तो मंज़ूर करने से पहले संपर्क को फ़ोन करें। |
| Step 3 | Approve or reject | मंज़ूर या नामंज़ूर करें |
| Step 3 text | Tap "Approve" to set up the company and its first owner. Tap "Reject" if the request is a duplicate or not a real plant. orrn shows "Request approved" when it is done. | कंपनी और उसका पहला मालिक बनाने के लिए "मंज़ूर करें" दबाएं। रिक्वेस्ट दोबारा आई हो या असली प्लांट की न हो तो "नामंज़ूर करें" दबाएं। काम हो जाने पर orrn "रिक्वेस्ट मंज़ूर हो गई" दिखाता है। |
| Step 4 | Send the sign-in details | साइन इन की जानकारी भेजें |
| Step 4 text | orrn emails the new owner. If the email doesn't arrive, copy the sign-in details shown after approval and send them yourself. | orrn नए मालिक को ईमेल भेजता है। ईमेल न पहुंचे तो मंज़ूरी के बाद दिखने वाली साइन इन की जानकारी कॉपी करें और खुद भेजें। |
| Step 5 | Check the new company | नई कंपनी जांचें |
| Step 5 text | Open the company under "Companies". Check the plan and modules, and that label printing is set up if the plant needs it. | "कंपनियां" में जाकर वो कंपनी खोलें। प्लान और मॉड्यूल जांचें, और प्लांट को ज़रूरत हो तो देखें कि लेबल प्रिंटिंग सेट है। |
| Problem 1 | The owner says no email came | मालिक कहता है ईमेल नहीं आया |
| Fix 1 | Look in their spam folder first. Then send the copied sign-in details by WhatsApp or phone. Ask them to change the password when they first sign in. | पहले उनका स्पैम फ़ोल्डर देखें। फिर कॉपी की हुई साइन इन की जानकारी WhatsApp या फ़ोन से भेजें। उनसे कहें कि पहली बार साइन इन करते ही पासवर्ड बदल लें। |
| Problem 2 | I approved the wrong request | गलत रिक्वेस्ट मंज़ूर हो गई |
| Fix 2 | Open the company under "Companies" and use "Suspend" until the mistake is sorted out. Do not delete anything. | "कंपनियां" में वो कंपनी खोलें और गलती सुलझने तक "रोकें" दबाएं। कुछ भी डिलीट न करें। |

### Sign in on the floor tablet (`floor-tablet-signin`)

| Part | English | हिंदी |
|---|---|---|
| Title | Sign in on the floor tablet | फ़्लोर टैबलेट पर साइन इन करें |
| When | Use this at the start of a shift, when you pick up the tablet at the packing or dispatch table. | शिफ़्ट की शुरुआत में, जब आप पैकिंग या dispatch टेबल का टैबलेट उठाते हैं। |
| Step 1 | Open orrn | orrn खोलें |
| Step 1 text | Open orrn from the icon on the tablet's home screen. If you see the page for another person, sign them out first. | टैबलेट की होम स्क्रीन के आइकन से orrn खोलें। अगर किसी और का पेज खुला दिखे तो पहले उन्हें साइन आउट करें। |
| Step 2 | Enter your email and password | ईमेल और पासवर्ड डालें |
| Step 2 text | Type your own work email and password and tap "Sign in". Do not use someone else's account, because every bundle and dispatch is recorded against the person who signed in. | अपना काम का ईमेल और पासवर्ड लिखें और "साइन इन करें" दबाएं। किसी और का अकाउंट इस्तेमाल न करें, क्योंकि हर bundle और dispatch उसी के नाम दर्ज होता है जिसने साइन इन किया। |
| Step 3 | Enter the code | कोड डालें |
| Step 3 text | If your account has two-factor on, open your authenticator app, type the 6-digit code and tap "Verify". Codes change every 30 seconds, so type the newest one. | अगर आपके अकाउंट पर two-factor चालू है, तो authenticator ऐप खोलें, 6 अंकों का कोड लिखें और "जांचें" दबाएं। कोड हर 30 सेकंड में बदलता है, इसलिए सबसे नया कोड डालें। |
| Step 4 | Check you are in the right plant | देखें कि सही प्लांट है |
| Step 4 text | You land on "Today". Check the company name at the top before you pack or dispatch. | आप "आज" पर पहुंचेंगे। पैक या dispatch करने से पहले ऊपर कंपनी का नाम जांचें। |
| Step 5 | Choose your language | अपनी भाषा चुनें |
| Step 5 text | Open "Account and more" and choose English or हिंदी under "Language". The tablet remembers it. | "अकाउंट और बाकी पेज" खोलें और "भाषा" में English या हिंदी चुनें। टैबलेट इसे याद रखता है। |
| Step 6 | Sign out at the end | आखिर में साइन आउट करें |
| Step 6 text | When you hand the tablet over or finish your shift, open "Account and more" and tap "Sign out". | टैबलेट किसी और को देते समय या शिफ़्ट खत्म होने पर "अकाउंट और बाकी पेज" खोलें और "साइन आउट" दबाएं। |
| Problem 1 | "Email or password is wrong. Check both and try again." | "ईमेल या पासवर्ड गलत है। दोनों जांचें और फिर से कोशिश करें।" |
| Fix 1 | Check for a capital letter or an extra space. If it still fails, ask your admin to reset your password. | कैपिटल अक्षर या बीच में खाली जगह जांचें। फिर भी न चले तो अपने एडमिन से पासवर्ड रीसेट करने को कहें। |
| Problem 2 | "Your session ended. Sign in again." | "आपका सेशन खत्म हो गया। फिर से साइन इन करें।" |
| Fix 2 | Sign in again. Anything you had not saved on the screen may need to be entered again. | दोबारा साइन इन करें। स्क्रीन पर जो सेव नहीं हुआ था उसे दोबारा डालना पड़ सकता है। |
| Problem 3 | "Your account isn't in a company yet" | "आपका अकाउंट अभी किसी कंपनी में नहीं है" |
| Fix 3 | You are signed in, but your admin has not added your email to the plant. Ask them to invite you. | आप साइन इन हैं, लेकिन आपके एडमिन ने आपका ईमेल प्लांट में नहीं जोड़ा है। उनसे इनवाइट भेजने को कहें। |

### Book and confirm a sales order (`book-order`)

| Part | English | हिंदी |
|---|---|---|
| Title | Book and confirm a sales order | सेल्स ऑर्डर बुक करें और पक्का करें |
| When | Use this when a customer sends a purchase order and you need its kg to stay on the books until they are dispatched. | जब ग्राहक का PO आए और उसका kg dispatch होने तक हिसाब में बना रहना चाहिए। |
| Step 1 | Start the order | ऑर्डर शुरू करें |
| Step 1 text | Open "Orders" and tap "New order". Search for the customer, then type the customer's PO number. The expected date starts a few days after the order date. Change it if the customer wants it sooner or later. | "ऑर्डर" खोलें और "नया ऑर्डर" दबाएं। ग्राहक खोजें, फिर ग्राहक का PO नंबर लिखें। उम्मीद की तारीख ऑर्डर की तारीख के कुछ दिन बाद से शुरू होती है। ग्राहक को जल्दी या देर से चाहिए तो बदल दें। |
| Step 2 | Add the die and the lengths | Die और लंबाइयां डालें |
| Step 2 text | Search the die by code or name. Under it, enter each cut length with its pieces or its kg. Press Enter in the pieces or kg box to add the next length. Tap "Add another die" for the next section. | Die को कोड या नाम से खोजें। उसके नीचे हर कट लंबाई के साथ पीस या kg डालें। अगली लंबाई जोड़ने के लिए पीस या kg के खाने में Enter दबाएं। अगले सेक्शन के लिए "एक और die जोड़ें" दबाएं। |
| Step 3 | Read the figures orrn works out | orrn के निकाले आंकड़े पढ़ें |
| Step 3 text | Type pieces and orrn gives the kg, or type kg and it gives the pieces. The weight comes from the copy's latest reading, or from the start of the die's band if the copy has none. You never work these out yourself. | पीस लिखें तो orrn kg बता देता है, kg लिखें तो पीस बता देता है। वज़न कॉपी की ताज़ा रीडिंग से आता है, और कॉपी में रीडिंग न हो तो die की रेंज की शुरुआत से। ये आंकड़े आपको खुद नहीं निकालने। |
| Step 4 | Book it | बुक करें |
| Step 4 text | Tap "Book order". The order is saved as "Booking" with its own sales order number. Nothing is promised to the floor yet. | "ऑर्डर बुक करें" दबाएं। ऑर्डर "बुकिंग" के रूप में अपने सेल्स ऑर्डर नंबर के साथ सेव होता है। फ्लोर से अभी कुछ वादा नहीं हुआ है। |
| Step 5 | Put ready stock on a line | लाइन पर तैयार स्टॉक रखें |
| Step 5 text | If bundles of that die are already in the yard, open the line and tap "Take ready stock". Plant stock and bundles on no order go on the line at once. Another customer's bundles wait for a manager. | उस die के bundle यार्ड में पहले से हों तो लाइन खोलें और "तैयार स्टॉक लें" दबाएं। प्लांट स्टॉक और बिना ऑर्डर वाले bundle उसी समय लाइन पर चले जाते हैं। दूसरे ग्राहक के bundle मैनेजर के इंतज़ार में रहते हैं। |
| Step 6 | Confirm | पक्का करें |
| Step 6 text | When the PO number and every line are complete, tap "Confirm order". If something is missing, orrn lists it. The order is now "Confirmed" and its lines can be planned for the press. | PO नंबर और हर लाइन पूरी हो जाए तो "ऑर्डर पक्का करें" दबाएं। कुछ छूटा हो तो orrn बता देता है। ऑर्डर अब "पक्का" है और उसकी लाइनें प्रेस के लिए प्लान हो सकती हैं। |
| Problem 1 | It says the PO is already on another order | लिखा आ रहा है कि PO दूसरे ऑर्डर पर पहले से है |
| Fix 1 | A PO number can be used once for each customer. Open the order it names. If it was booked twice by mistake, cancel the extra one with "Cancel order". | एक ग्राहक के लिए एक PO नंबर एक ही बार चल सकता है। जो ऑर्डर बताया गया है उसे खोलें। गलती से दो बार बुक हुआ हो तो फालतू वाले को "ऑर्डर रद्द करें" से रद्द करें। |
| Problem 2 | The die belongs to another customer | Die किसी दूसरे ग्राहक की है |
| Fix 2 | A die that belongs to one customer cannot be booked for another. Ask the die room who owns it, or pick the right customer. | एक ग्राहक की अपनी die दूसरे ग्राहक के लिए बुक नहीं हो सकती। die रूम से पूछें कि वो किसकी है, या सही ग्राहक चुनें। |
| Problem 3 | I want to change a line after booking | बुकिंग के बाद लाइन बदलनी है |
| Fix 3 | Open the order and tap "Edit lines". A line that is already on a released press plan keeps its kg, pieces, length and die. A line cannot go below what is already dispatched. | ऑर्डर खोलें और "लाइनें बदलें" दबाएं। जो लाइन रिलीज़ हो चुके प्रेस प्लान पर है, उसके kg, पीस, लंबाई और die नहीं बदलते। लाइन उससे कम नहीं हो सकती जितना dispatch हो चुका है। |

### Hold yard stock for an order line (`hold-for-order`)

| Part | English | हिंदी |
|---|---|---|
| Title | Hold yard stock for an order line | ऑर्डर लाइन के लिए यार्ड का स्टॉक होल्ड करें |
| When | Use this when finished bundles are lying in the yard and you want to keep them for one customer's order. | जब तैयार bundle यार्ड में पड़े हों और आप उन्हें एक ग्राहक के ऑर्डर के लिए रखना चाहते हों। |
| Step 1 | Open the order | ऑर्डर खोलें |
| Step 1 text | Open "Orders" and tap the order. Find the line you want the stock to go against. | "ऑर्डर" खोलें और ऑर्डर दबाएं। वो लाइन ढूंढें जिस पर स्टॉक लगाना है। |
| Step 2 | Pick the bundles | Bundle चुनें |
| Step 2 text | On that line tap "Hold stock". orrn lists yard bundles of the same die that are on no order, or already on this line. Tick the ones you want. A bundle with a different cut length can be held. orrn warns you and holds it anyway. | उस लाइन पर "स्टॉक होल्ड करें" दबाएं। orrn उसी die के यार्ड के वो bundle दिखाता है जो किसी ऑर्डर पर नहीं हैं, या इसी लाइन पर हैं। जो चाहिए उन पर निशान लगाएं। अलग कट लंबाई वाला bundle भी होल्ड हो सकता है। orrn चेतावनी देता है और फिर भी होल्ड कर देता है। |
| Step 3 | Hold them | होल्ड करें |
| Step 3 text | Confirm the hold. The bundles stay where they are in the yard. While they are held, no other customer's dispatch can take them. | होल्ड पक्का करें। Bundle यार्ड में वहीं रहते हैं जहां थे। होल्ड के दौरान कोई दूसरा ग्राहक अपने dispatch में इन्हें नहीं ले सकता। |
| Step 4 | Check the line | लाइन देखें |
| Step 4 text | The line shows a "Held bundles" list and a count with the kg held. The held kg also show on the order's balance figures. | लाइन पर "होल्ड bundle" की लिस्ट और होल्ड हुए kg की गिनती दिखती है। होल्ड के kg ऑर्डर के बैलेंस आंकड़ों में भी दिखते हैं। |
| Step 5 | Release when plans change | प्लान बदले तो छोड़ें |
| Step 5 text | In the "Held bundles" list tick the bundles and tap Release, or tap "Release all". The bundles are free stock again. | "होल्ड bundle" की लिस्ट में bundle चुनकर होल्ड हटाएं, या "सब होल्ड हटाएं" दबाएं। Bundle फिर खुला स्टॉक बन जाते हैं। |
| Problem 1 | A bundle is not in the list | कोई bundle लिस्ट में नहीं है |
| Fix 1 | Only bundles in the yard can be held. A bundle on a dispatch, held for another line, waiting for a move approval or of a different die is left out. The list says why. | सिर्फ यार्ड के bundle होल्ड हो सकते हैं। जो bundle dispatch पर है, किसी दूसरी लाइन के लिए होल्ड है, मूव की मंज़ूरी के इंतज़ार में है या दूसरी die का है, वो छूट जाता है। लिस्ट में वजह लिखी होती है। |
| Problem 2 | A scan says the bundle is held for an order | स्कैन में लिखा आया कि bundle ऑर्डर के लिए होल्ड है |
| Fix 2 | The bundle is held for another customer's line. Choose another bundle, or ask the office to release the hold. Do not force it onto the truck. | वो bundle किसी दूसरे ग्राहक की लाइन के लिए होल्ड है। दूसरा bundle चुनें, या ऑफिस से होल्ड हटवाएं। उसे ज़बरदस्ती ट्रक पर न डालें। |
| Problem 3 | I held a bundle by mistake | गलती से bundle होल्ड हो गया |
| Fix 3 | Release it from the "Held bundles" list. Voiding a held bundle, or closing or cancelling the order, also releases the hold. | "होल्ड bundle" की लिस्ट से उसका होल्ड हटा दें। होल्ड वाले bundle को रद्द करने से, या ऑर्डर बंद या रद्द करने से भी होल्ड हट जाता है। |

### Move bundles to another order (`reallocate-bundles`)

| Part | English | हिंदी |
|---|---|---|
| Title | Move bundles to another order | Bundle को दूसरे ऑर्डर पर डालें |
| When | Use this when finished bundles were packed for one order but should go to another order, or back to plant stock. | जब तैयार bundle एक ऑर्डर के लिए पैक हुए थे पर अब दूसरे ऑर्डर पर जाने चाहिए, या वापस प्लांट स्टॉक में। |
| Step 1 | Open the line they are on | वो लाइन खोलें जिस पर वो हैं |
| Step 1 text | Open the order the bundles are on, find the line and tap "Move bundles". | जिस ऑर्डर पर bundle हैं उसे खोलें, लाइन ढूंढें और "Bundle डालें" दबाएं। |
| Step 2 | Choose where they go | कहां जाएंगे, चुनें |
| Step 2 text | Under "Move to" pick the other order line. Pick "Plant stock" if the bundles are free again. Only bundles of the same die can go to an order line. | "कहां डालें" में दूसरी ऑर्डर लाइन चुनें। bundle फिर खुले हो जाएं तो "प्लांट स्टॉक" चुनें। ऑर्डर लाइन पर सिर्फ उसी die के bundle जा सकते हैं। |
| Step 3 | Pick the bundles | Bundle चुनें |
| Step 3 text | Tick the bundles to move, or tap "Select all". Only available bundles can move. A bundle on a truck or void is listed with the reason it cannot move. | जो bundle डालने हैं उन पर निशान लगाएं, या "सब चुनें" दबाएं। सिर्फ available bundle मूव होते हैं। ट्रक पर लगा या रद्द bundle वजह के साथ दिखता है कि वो क्यों नहीं जा सकता। |
| Step 4 | Give a reason if the length differs | लंबाई अलग हो तो कारण दें |
| Step 4 text | If the cut length is not the one on the new line, orrn warns you and asks for a "Reason". Pick one from the list or write a note. | कट लंबाई नई लाइन वाली न हो तो orrn चेतावनी देता है और "कारण" मांगता है। लिस्ट से चुनें या नोट लिखें। |
| Step 5 | Move | डालें |
| Step 5 text | Tap "Move". Moving to plant stock or to the same customer's other order happens at once. Moving to another customer's order waits for a manager, and the bundles stay where they are until it is approved. | "डालें" दबाएं। प्लांट स्टॉक में या उसी ग्राहक के दूसरे ऑर्डर पर मूव उसी समय हो जाता है। दूसरे ग्राहक के ऑर्डर पर मूव मैनेजर के इंतज़ार में रहता है, और मंज़ूरी तक bundle वहीं रहते हैं। |
| Problem 1 | It says Waiting for a manager | लिखा है कि मैनेजर का इंतज़ार है |
| Fix 1 | The move is to another customer's order. A manager, admin or owner approves it in "Approvals". The order timeline shows the request and, once decided, the move. | मूव दूसरे ग्राहक के ऑर्डर पर है। मैनेजर, एडमिन या मालिक इसे "मंज़ूरी" में पास करता है। ऑर्डर की टाइमलाइन में अनुरोध दिखता है और फैसले के बाद मूव। |
| Problem 2 | A bundle cannot be moved | कोई bundle मूव नहीं हो रहा |
| Fix 2 | It is dispatched, void, on a live dispatch, or already in a pending move. Remove it from the dispatch first, or wait for the approval. | वो dispatch हो चुका है, रद्द है, चालू dispatch पर है या पहले से किसी मूव की मंज़ूरी में है। उसे पहले dispatch से हटाएं, या मंज़ूरी का इंतज़ार करें। |
| Problem 3 | The die belongs to a customer | Die किसी ग्राहक की अपनी है |
| Fix 3 | A bundle of a customer's own die cannot go to another customer. Ask the die room whether an owner exception has been approved. | ग्राहक की अपनी die का bundle दूसरे ग्राहक पर नहीं जा सकता। die रूम से पूछें कि मालिकाना छूट मंज़ूर हुई है या नहीं। |

### Plan the press and release it (`plan-press-run`)

| Part | English | हिंदी |
|---|---|---|
| Title | Plan the press and release it | प्रेस का प्लान बनाएं और रिलीज़ करें |
| When | Use this when confirmed orders have kg still to make and the press needs its list for the next shift or day. | जब पक्के ऑर्डरों में बनाने के लिए kg बाकी हों और प्रेस को अगली शिफ्ट या दिन की लिस्ट चाहिए। |
| Step 1 | Open the plan board | प्लान बोर्ड खोलें |
| Step 1 text | Open "Orders" and tap "Press plan". This page works on a desktop or an 11-inch tablet. | "ऑर्डर" खोलें और "प्रेस प्लान" दबाएं। ये पेज डेस्कटॉप या 11 इंच के टैबलेट पर चलता है। |
| Step 2 | Set the window and the press | समय और प्रेस तय करें |
| Step 2 text | Set "Window starts" and "Window ends". A window is at most 24 hours. Pick the press under "Pick the press". | "समय शुरू" और "समय खत्म" भरें। समय अधिकतम 24 घंटे का होता है। "प्रेस चुनें" में प्रेस चुनें। |
| Step 3 | Choose the lines | लाइनें चुनें |
| Step 3 text | The open lines come grouped by die, so one die serves every customer that needs it. Add the lines you want. Leave the kg blank to plan all that is left, or type fewer kg. | खुली लाइनें die के हिसाब से इकट्ठी आती हैं, ताकि एक die सारे ज़रूरतमंद ग्राहकों के काम आए। जो लाइनें चाहिए जोड़ें। सारा बाकी प्लान करना हो तो kg खाली छोड़ें, वरना कम kg लिखें। |
| Step 4 | Read the other customers | दूसरे ग्राहक देखें |
| Step 4 text | When you add a die, orrn lists every other open line on it, with the customer, length and kg still to plan. Add them to press them in the same run. orrn only warns. It never blocks. | Die जोड़ते ही orrn उस पर बाकी हर खुली लाइन दिखाता है, ग्राहक, लंबाई और प्लान होने वाले kg के साथ। उन्हें जोड़ें तो वो उसी रन में दब जाएंगी। orrn सिर्फ चेतावनी देता है, रोकता कभी नहीं। |
| Step 5 | Save the draft | ड्राफ़्ट सेव करें |
| Step 5 text | Tap "Save draft plan". Reorder the dies with "Move earlier" and "Move later". Mark one "Mark urgent" if it must go first. | "ड्राफ़्ट प्लान सेव करें" दबाएं। Die का क्रम "पहले करें" और "बाद में करें" से बदलें। जो सबसे पहले जाना है उस पर "जल्दी करें" दबाएं। |
| Step 6 | Release to the press | प्रेस को भेजें |
| Step 6 text | Open the plan and tap "Release to press". Each die becomes one queued run on the press. The die room picks the copy when it issues the die. | प्लान खोलें और "प्रेस को भेजें" दबाएं। हर die प्रेस पर एक कतार वाला रन बन जाती है। कॉपी die रूम तब चुनता है जब वो die देता है। |
| Problem 1 | It says More than the order can still take | लिखा है कि ऑर्डर जितना ले सकता है उससे ज़्यादा है |
| Fix 1 | The line has less kg left to plan than you asked for. Another plan, a pack or a dispatch already used some. Lower the kg. | लाइन पर प्लान होने लायक kg आपके मांगे kg से कम हैं। कोई दूसरा प्लान, पैकिंग या dispatch उसमें से कुछ ले चुका है। kg घटाएं। |
| Problem 2 | The die belongs to a customer | Die किसी ग्राहक की अपनी है |
| Fix 2 | A die that belongs to one customer cannot take another customer's line. The line is marked. Plan it on its own, or ask the die room. | एक ग्राहक की अपनी die पर दूसरे ग्राहक की लाइन नहीं लग सकती। लाइन पर निशान लगा होता है। उसे अलग प्लान करें, या die रूम से पूछें। |
| Problem 3 | I need to change a released plan | रिलीज़ हो चुका प्लान बदलना है |
| Fix 3 | A draft can be edited. After release, the supervisor moves runs in the press queue, and a cut length can be taken back to planning with "Take back to planning". To stop the whole plan, tap "Cancel plan" before any die is issued. | ड्राफ़्ट बदला जा सकता है। रिलीज़ के बाद सुपरवाइज़र प्रेस की कतार में रन आगे-पीछे करता है, और कोई कट लंबाई "प्लानिंग में वापस लें" से वापस ली जा सकती है। पूरा प्लान रोकना हो तो कोई die देने से पहले "प्लान रद्द करें" दबाएं। |

### Run the press at the station (`press-station-day`)

| Part | English | हिंदी |
|---|---|---|
| Title | Run the press at the station | स्टेशन पर प्रेस चलाएं |
| When | Use this at the press tablet, from the moment the die is issued to the moment the run is logged. | प्रेस के टैबलेट पर, die मिलने से लेकर रन दर्ज होने तक। |
| Step 1 | Open your run | अपना रन खोलें |
| Step 1 text | Open "Press" and tap the press. Tap the run at the top of the queue. If it says the die is not issued, wait for the die room. Start stays locked until they hand it over. | "प्रेस" खोलें और प्रेस दबाएं। कतार में सबसे ऊपर वाला रन दबाएं। लिखा हो कि die नहीं मिली, तो die रूम का इंतज़ार करें। जब तक वो नहीं देते, शुरू बंद रहता है। |
| Step 2 | Start and stop | शुरू और बंद |
| Step 2 text | When the die is in and the billet goes in, tap "Start". orrn takes the time from the server clock, not from the tablet. If you stop and start again, tap "Stop" and "Resume". "Undo start" is there for a tap by mistake. | Die लग जाए और बिलेट अंदर जाए तो "शुरू करें" दबाएं। समय टैबलेट से नहीं, सर्वर की घड़ी से लिया जाता है। रोककर फिर चलाना हो तो "रोकें" और "फिर चालू करें" दबाएं। गलती से दब जाए तो "शुरू करना वापस लें" है। |
| Step 3 | Count the run | रन गिनें |
| Step 3 text | After the press stops, tap "Count & check". Step through the billets, the pieces for each cut length, the butt and ends, and the rejects. Type 0 for rejects when there were none. A blank is not a check. | प्रेस रुकने के बाद "गिनती और जाँच" दबाएं। बिलेट, हर कट लंबाई के पीस, बट और एंड, और रिजेक्ट एक-एक करके भरें। रिजेक्ट न हों तो 0 लिखें। खाली छोड़ना जाँच नहीं है। |
| Step 4 | Read the figures | आंकड़े पढ़ें |
| Step 4 text | Recovery and balance come from the server. If the billet stock shows less than you weighed, orrn still logs the weighed kg and asks why. The cast then shows the shortage for the foundry. | रिकवरी और बैलेंस सर्वर से आते हैं। बिलेट स्टॉक में आपके तौले हुए से कम दिखे तो भी orrn तौला हुआ kg दर्ज करता है और वजह पूछता है। फिर कास्ट पर फाउंड्री के लिए कमी दिखती है। |
| Step 5 | Hand it to the supervisor | सुपरवाइज़र को दें |
| Step 5 text | Everything you type is saved as you go. The supervisor taps "Log run" to finish it. Until then the run is not final. | आप जो भरते हैं वो साथ-साथ सेव होता जाता है। सुपरवाइज़र "रन दर्ज करें" दबाकर इसे पूरा करता है। तब तक रन आखिरी नहीं है। |
| Step 6 | Change of man | प्रेस मैन बदले तो |
| Step 6 text | If another press man takes over, use the handover and name the relief. The run keeps its start time. | दूसरा प्रेस मैन संभाले तो हैंडओवर में रिलीफ का नाम डालें। रन का शुरू समय वही रहता है। |
| Problem 1 | Start is locked | शुरू बंद है |
| Fix 1 | The die has not been issued to this run. Ask the die room to issue it. A die issued for another run or press does not unlock this one. | इस रन के लिए die नहीं दी गई है। die रूम से कहें कि दें। किसी दूसरे रन या प्रेस की die से ये नहीं खुलता। |
| Problem 2 | It says the tablet clock differs from the server | लिखा है कि टैबलेट की घड़ी सर्वर से अलग है |
| Fix 2 | More than 2 minutes apart. Start and stop still save. A supervisor confirms the times with "Ask a supervisor to confirm the times". | 2 मिनट से ज़्यादा का फर्क है। शुरू और बंद फिर भी सेव होते हैं। सुपरवाइज़र "सुपरवाइज़र से समय पक्का करने को कहें" से समय पक्का करता है। |
| Problem 3 | Log run is greyed out | रन दर्ज करें दबता नहीं |
| Fix 3 | Only the run's supervisor can log it, and the gates must pass. The close preview lists what is still missing. | सिर्फ रन का सुपरवाइज़र इसे दर्ज कर सकता है, और सारे गेट पास होने चाहिए। क्लोज़ प्रीव्यू में दिखता है कि क्या बाकी है। |
| Problem 4 | A figure is wrong after logging | दर्ज करने के बाद कोई आंकड़ा गलत निकला |
| Fix 4 | Tap "Request reopen" and say why. A manager decides. Do not log a second run to fix it. | "फिर खोलने का अनुरोध" दबाएं और वजह लिखें। मैनेजर फैसला करता है। उसे सुधारने के लिए दूसरा रन दर्ज न करें। |

### Enter a run that was done on paper (`press-late-entry`)

| Part | English | हिंदी |
|---|---|---|
| Title | Enter a run that was done on paper | कागज़ पर हुआ रन बाद में भरें |
| When | Use this when the tablet was not used and a run that has already stopped has to be put into orrn afterwards. | जब टैबलेट इस्तेमाल नहीं हुआ और रुक चुका रन orrn में बाद में डालना है। |
| Step 1 | Open the press queue | प्रेस की कतार खोलें |
| Step 1 text | Open "Press", tap the press and tap "Late entry". Only a run from the last 7 days can be entered late. Older runs are not accepted. | "प्रेस" खोलें, प्रेस दबाएं और "देर से एंट्री" दबाएं। सिर्फ पिछले 7 दिन का रन देर से भरा जा सकता है। उससे पुराने रन नहीं लिए जाते। |
| Step 2 | Say which run | बताएं कौन सा रन |
| Step 2 text | Pick "A run from the queue" if the plan was released, or "A run not in the queue". For a queued run, pick the die copy that was used. | प्लान रिलीज़ हुआ था तो "कतार का रन" चुनें, वरना "कतार से बाहर का रन"। कतार वाले रन के लिए वो die कॉपी चुनें जो लगी थी। |
| Step 3 | Give the true times | असली समय डालें |
| Step 3 text | Fill in "Started" and "Stopped" with the real times from the paper, the operator and the relief operator if any. The stop must be after the start and cannot be in the future. | कागज़ से असली समय "शुरू" और "बंद" में भरें, साथ में ऑपरेटर और रिलीफ ऑपरेटर हो तो वो भी। बंद का समय शुरू के बाद का हो और आगे का न हो। |
| Step 4 | Say why it is late | देरी की वजह लिखें |
| Step 4 text | Write the reason in "Why it is entered late". | "देर से क्यों भरा" में वजह लिखें। |
| Step 5 | Enter the run | रन भरें |
| Step 5 text | Tap "Enter the run". The run is marked "Entered late" and waits for a second person to approve. You cannot approve your own. | "रन भरें" दबाएं। रन पर "देर से भरा" का निशान लगता है और दूसरे आदमी की मंज़ूरी का इंतज़ार रहता है। अपना भरा आप खुद पास नहीं कर सकते। |
| Step 6 | Count and log it | गिनें और दर्ज करें |
| Step 6 text | Once approved, open the run and count it as usual, then log it. The late share of runs shows on the press summary. | मंज़ूरी के बाद रन खोलें, पहले जैसे गिनें और फिर दर्ज करें। देर से भरे रनों का हिस्सा प्रेस समरी में दिखता है। |
| Problem 1 | It says the start is too long ago | लिखा है कि शुरू का समय बहुत पुराना है |
| Fix 1 | Late entry is for the last 7 days only. For an older run, ask the manager how to correct the books. | देर से एंट्री सिर्फ पिछले 7 दिनों के लिए है। उससे पुराने रन के लिए मैनेजर से पूछें कि हिसाब कैसे ठीक होगा। |
| Problem 2 | No die copy to pick | चुनने के लिए कोई die कॉपी नहीं है |
| Fix 2 | Only copies of that run's die that are in the rack can be picked. A copy on trial is offered only for a die trial run. Ask the die room. | उस रन की die की सिर्फ वो कॉपियां चुनी जा सकती हैं जो रैक में हैं। ट्रायल वाली कॉपी सिर्फ die ट्रायल रन के लिए दिखती है। die रूम से पूछें। |
| Problem 3 | The run is waiting and nothing happens | रन इंतज़ार में है और कुछ नहीं हो रहा |
| Fix 3 | Ask a manager, a supervisor or the owner to open "Approvals" and decide it. You cannot approve your own. | मैनेजर, सुपरवाइज़र या मालिक से कहें कि "मंज़ूरी" खोलकर फैसला करें। अपना भरा आप पास नहीं कर सकते। |

### Record a press stoppage (`press-downtime`)

| Part | English | हिंदी |
|---|---|---|
| Title | Record a press stoppage | प्रेस का रुकना दर्ज करें |
| When | Use this whenever the press stops for something other than the end of a run, such as a breakdown, a die change or no billets. | जब भी प्रेस रन खत्म होने के अलावा किसी और वजह से रुके, जैसे खराबी, die बदलना या बिलेट न होना। |
| Step 1 | Open the run | रन खोलें |
| Step 1 text | Open "Press", tap the press and open the run in progress. | "प्रेस" खोलें, प्रेस दबाएं और चालू रन खोलें। |
| Step 2 | Start the stoppage | रुकना शुरू करें |
| Step 2 text | Tap "Press stopped". Pick the reason from the list. If none fits, pick Other and write a note. The time is taken from the server clock. | "प्रेस रुकी" दबाएं। लिस्ट से वजह चुनें। कोई वजह न बैठे तो Other चुनकर नोट लिखें। समय सर्वर की घड़ी से लिया जाता है। |
| Step 3 | Fix the fault | खराबी ठीक करें |
| Step 3 text | The stoppage stays open and the tablet shows how long it has been. Only one stoppage can be open on a press. | रुकना खुला रहता है और टैबलेट पर दिखता है कि कितनी देर हुई। एक प्रेस पर एक ही रुकना खुला हो सकता है। |
| Step 4 | End the stoppage | रुकना खत्म करें |
| Step 4 text | When the press runs again tap "Press running again". The minutes are saved against the reason. | प्रेस फिर चले तो "प्रेस फिर चालू" दबाएं। मिनट उस वजह के नाम सेव हो जाते हैं। |
| Step 5 | Check it later | बाद में देखें |
| Step 5 text | The stoppages of the day, longest first, are on the press summary. The supervisor uses them to see where the hours went. | दिन के रुकने, सबसे लंबे पहले, प्रेस समरी में हैं। सुपरवाइज़र उनसे देखता है कि घंटे कहां गए। |
| Problem 1 | It says a stoppage is already running | लिखा है कि एक रुकना पहले से चल रहा है |
| Fix 1 | Another one is open on this press. End it first with "Press running again". | इस प्रेस पर दूसरा खुला है। पहले उसे "प्रेस फिर चालू" से खत्म करें। |
| Problem 2 | I cannot log the run | रन दर्ज नहीं हो रहा |
| Fix 2 | An open stoppage blocks the close. End it, then count and log again. | खुला रुकना क्लोज़ रोक देता है। उसे खत्म करें, फिर गिनकर दोबारा दर्ज करें। |
| Problem 3 | The reason I need is not in the list | जो वजह चाहिए वो लिस्ट में नहीं है |
| Fix 3 | Pick Other and write a note. A manager can add the reason under reason codes. | Other चुनकर नोट लिखें। मैनेजर रीज़न कोड में नई वजह जोड़ सकता है। |

### Add a die weight reading (`die-reading`)

| Part | English | हिंदी |
|---|---|---|
| Title | Add a die weight reading | Die की वज़न रीडिंग जोड़ें |
| When | Use this after pressing, when you have weighed 12 ft off a die and want its wear recorded. | प्रेस के बाद, जब आपने die से 12 ft तौला हो और उसका घिसना दर्ज करना हो। |
| Step 1 | Find the copy | कॉपी ढूंढें |
| Step 1 text | Open "Dies", search the section, and open the copy you pressed with. | "Die" खोलें, सेक्शन खोजें और जिस कॉपी से प्रेस किया उसे खोलें। |
| Step 2 | Weigh 12 ft | 12 ft तौलें |
| Step 2 text | Cut 12 ft off the section from that die and weigh it on the bench scale. Write the weight in kg. | उस die से सेक्शन का 12 ft काटें और बेंच के कांटे पर तौलें। वज़न kg में लिख लें। |
| Step 3 | Add the reading | रीडिंग जोड़ें |
| Step 3 text | On the "Readings" tab tap "Add reading" and type the weight of 12 ft. orrn shows the band and the last reading under the box. | "रीडिंग" टैब पर "रीडिंग जोड़ें" दबाएं और 12 ft का वज़न लिखें। खाने के नीचे orrn रेंज और पिछली रीडिंग दिखाता है। |
| Step 4 | Save and read the colour | सेव करें और रंग पढ़ें |
| Step 4 text | Save it. The percent and the colour are worked out by orrn when you save. Green is in range. Amber and red mean the die is wearing and the drift is growing. | सेव करें। प्रतिशत और रंग सेव करते समय orrn निकालता है। हरा मतलब रेंज में। पीला और लाल मतलब die घिस रही है और फर्क बढ़ रहा है। |
| Step 5 | Tell the die room | die रूम को बताएं |
| Step 5 text | If the colour is red, tell the die room. A heavier copy may be needed, or the die may need correction. | रंग लाल हो तो die रूम को बताएं। भारी कॉपी चाहिए हो सकती है, या die को सुधारना पड़ सकता है। |
| Problem 1 | I typed the wrong weight | गलत वज़न लिख दिया |
| Fix 1 | A saved reading cannot be edited. Add a new correct reading. The newest one is the one orrn uses. | सेव हुई रीडिंग बदली नहीं जा सकती। सही नई रीडिंग जोड़ दें। orrn सबसे नई वाली इस्तेमाल करता है। |
| Problem 2 | There is no Add reading button | रीडिंग जोड़ने का बटन नहीं है |
| Fix 2 | A retired copy takes no readings and keeps its number. | बंद की हुई कॉपी पर रीडिंग नहीं ली जाती और उसका नंबर वही रहता है। |
| Problem 3 | It says Trial weight. Not a drift reading. | लिखा है Trial weight. Not a drift reading. |
| Fix 3 | That figure came from the die maker's trial. It is the starting weight and does not count as wear. | वो आंकड़ा die मेकर के ट्रायल का है। वो शुरुआती वज़न है, घिसना नहीं गिना जाता। |

### Issue a die to the press and take it back (`die-issue-return`)

| Part | English | हिंदी |
|---|---|---|
| Title | Issue a die to the press and take it back | प्रेस को die दें और वापस लें |
| When | Use this when a queued press run is waiting for its die, and again when the run is finished. | जब कतार वाला प्रेस रन अपनी die का इंतज़ार कर रहा हो, और फिर रन खत्म होने पर। |
| Step 1 | Open the issue page | देने का पेज खोलें |
| Step 1 text | Open "Dies" and tap "Issue and return". Pick the press run that is waiting. The run decides the press line. | "Die" खोलें और "प्रेस को दें और वापस लें" दबाएं। वो प्रेस रन चुनें जो इंतज़ार में है। प्रेस लाइन रन से तय होती है। |
| Step 2 | Pick the copy | कॉपी चुनें |
| Step 2 text | Pick a copy from the rack. orrn lists only copies of the run's section. A copy on trial goes only to a die trial run. A customer's own die goes only to that customer's runs. | रैक से कॉपी चुनें। orrn सिर्फ रन के सेक्शन की कॉपियां दिखाता है। ट्रायल वाली कॉपी सिर्फ die ट्रायल रन पर जाती है। ग्राहक की अपनी die सिर्फ उसी ग्राहक के रन पर जाती है। |
| Step 3 | Issue it | दें |
| Step 3 text | Tap "Issue". The copy is now on the press line and the run says "Die issued". The press can start. A line can hold the running die and one more die for the next run, heated in the oven. A third is refused. | "दें" दबाएं। कॉपी अब प्रेस लाइन पर है और रन पर "Die मिल गई" लिखा है। प्रेस शुरू हो सकती है। एक लाइन पर चलती die के साथ अगले रन की एक और die हो सकती है, जो ओवन में गरम होती है। तीसरी मना है। |
| Step 4 | Take it back | वापस लें |
| Step 4 text | When the run is finished and the die is out, find the copy under "On a press now" and tap "Take back". It goes back to the rack. | रन खत्म हो जाए और die निकल जाए तो "अभी प्रेस पर" में कॉपी ढूंढें और "वापस लें" दबाएं। वो रैक में लौट जाती है। |
| Step 5 | Add the reading | रीडिंग जोड़ें |
| Step 5 text | Weigh 12 ft and add a reading for the copy, so the card shows its wear. | 12 ft तौलें और कॉपी की रीडिंग जोड़ें, ताकि कार्ड पर उसका घिसना दिखे। |
| Problem 1 | It says the die is still on the press | लिखा है कि die अभी प्रेस पर है |
| Fix 1 | The run has the die in the press. Take it back after the die is out and the run is logged. | रन में die प्रेस के अंदर है। die निकलने और रन दर्ज होने के बाद उसे वापस लें। |
| Problem 2 | I issued the wrong copy | गलत कॉपी दे दी |
| Fix 2 | Before the press starts, tap "Cancel issue". The copy goes back to the rack and the run waits for a die again. | प्रेस शुरू होने से पहले "देना रद्द करें" दबाएं। कॉपी रैक में लौट जाती है और रन फिर die का इंतज़ार करता है। |
| Problem 3 | No press run is waiting for this section | इस सेक्शन के लिए कोई प्रेस रन इंतज़ार में नहीं है |
| Fix 3 | Ask the office to release the plan first. A die cannot be issued without a queued run. | ऑफिस से कहें कि पहले प्लान रिलीज़ करे। कतार वाले रन के बिना die नहीं दी जा सकती। |

### Release a die copy that is on trial (`die-trial`)

| Part | English | हिंदी |
|---|---|---|
| Title | Release a die copy that is on trial | ट्रायल पर रखी die कॉपी को छोड़ें |
| When | Use this when a new copy, or a copy back from the die maker, is on trial and has to be proved or released before it is used for orders. | जब नई कॉपी, या die मेकर से लौटी कॉपी, ट्रायल पर हो और ऑर्डर के काम आने से पहले उसे साबित करना या छोड़ना हो। |
| Step 1 | Know why it is on trial | समझें कि ट्रायल पर क्यों है |
| Step 1 text | A new copy and a copy back from the die maker start "On trial". It goes only to a die trial run, never to a customer order. | नई कॉपी और die मेकर से लौटी कॉपी "ट्रायल पर" शुरू होती है। वो सिर्फ die ट्रायल रन पर जाती है, ग्राहक के ऑर्डर पर कभी नहीं। |
| Step 2 | See what is waiting | देखें क्या इंतज़ार में है |
| Step 2 text | Open "Dies". Copies on trial have their own tile on the board. Open a copy to see its trial panel. | "Die" खोलें। ट्रायल वाली कॉपियों का बोर्ड पर अपना टाइल होता है। कॉपी खोलकर उसका ट्रायल पैनल देखें। |
| Step 3 | Use a trial run if there is one | ट्रायल रन हो तो उसे इस्तेमाल करें |
| Step 3 text | If a die trial run is waiting for this section, tap "Issue to a trial run", or use "Issue and return" and pick the trial run. The supervisor logs the run and says "Trial passed" or "Trial failed". | इस सेक्शन के लिए die ट्रायल रन इंतज़ार में हो तो "ट्रायल रन को दें" दबाएं, या "प्रेस को दें और वापस लें" से ट्रायल रन चुनें। सुपरवाइज़र रन दर्ज करता है और "ट्रायल पास" या "ट्रायल फेल" बताता है। |
| Step 4 | After the trial | ट्रायल के बाद |
| Step 4 text | A copy that passed becomes available when it comes back to the rack. A copy that failed stays on trial. | पास हुई कॉपी रैक में लौटते ही available हो जाती है। फेल हुई कॉपी ट्रायल पर ही रहती है। |
| Step 5 | Or release it with a reason | या कारण लिखकर छोड़ें |
| Step 5 text | A manager can tap "Release without a trial" and write why. The reason is kept in the audit trail. | मैनेजर "ट्रायल के बिना छोड़ें" दबाकर वजह लिख सकता है। वजह ऑडिट में रहती है। |
| Problem 1 | The copy is still On trial after a good run | अच्छे रन के बाद भी कॉपी ट्रायल पर है |
| Fix 1 | The run's trial result must be set to passed when it is logged. A reopened run puts the copy back on trial. | रन दर्ज करते समय ट्रायल का नतीजा पास भरा होना चाहिए। फिर से खोला गया रन कॉपी को वापस ट्रायल पर डाल देता है। |
| Problem 2 | There is no trial run for this section | इस सेक्शन के लिए कोई ट्रायल रन नहीं है |
| Fix 2 | orrn has no planning screen for a die trial yet, so a trial run is set up by orrn support. Until then a manager can use "Release without a trial" and write why. | die ट्रायल की प्लानिंग का अभी कोई स्क्रीन नहीं है, इसलिए ट्रायल रन orrn सपोर्ट लगाता है। तब तक मैनेजर "ट्रायल के बिना छोड़ें" से वजह लिखकर छोड़ सकता है। |
| Problem 3 | I do not want new copies on trial | मुझे नई कॉपी ट्रायल पर नहीं चाहिए |
| Fix 3 | The owner or the plant admin can switch "New copies start on trial" off on the die board. Do this only if the plant agrees. | मालिक या प्लांट एडमिन die बोर्ड पर "नई कॉपी ट्रायल से शुरू हो" बंद कर सकता है। ये तभी करें जब प्लांट राज़ी हो। |

### Attach many drawings by file name (`bulk-drawings`)

| Part | English | हिंदी |
|---|---|---|
| Title | Attach many drawings by file name | फ़ाइल के नाम से कई ड्रॉइंग एक साथ जोड़ें |
| When | Use this when the plant's drawing files are named by die or copy code and you want them on the right cards in one go. | जब प्लांट की ड्रॉइंग फ़ाइलों के नाम die या कॉपी कोड पर हों और आप उन्हें एक बार में सही कार्ड पर लगाना चाहें। |
| Step 1 | Name the files | फ़ाइलों के नाम रखें |
| Step 1 text | A file called 12170.pdf goes to die 12170. A file called 12170-1.cdr goes to copy 12170-1. A PDF becomes the press drawing only if the die has none. | 12170.pdf नाम की फ़ाइल die 12170 पर जाती है। 12170-1.cdr नाम की फ़ाइल कॉपी 12170-1 पर जाती है। PDF तभी प्रेस ड्रॉइंग बनती है जब die की कोई ड्रॉइंग न हो। |
| Step 2 | Open the bulk page | बल्क पेज खोलें |
| Step 2 text | Open "Dies", open the menu and tap "Attach drawings by file name". | "Die" खोलें, मेनू खोलें और "फ़ाइल के नाम से ड्रॉइंग जोड़ें" दबाएं। |
| Step 3 | Pick the files | फ़ाइलें चुनें |
| Step 3 text | Pick many files at once. orrn reads the file names and lists what it will attach, what is already there and what it could not match. | एक साथ कई फ़ाइलें चुनें। orrn फ़ाइलों के नाम पढ़कर बताता है कि क्या जुड़ेगा, क्या पहले से है और किसका मेल नहीं मिला। |
| Step 4 | Attach | जोड़ें |
| Step 4 text | Check the list and tap the attach button. The files go one at a time, with a count as they go. | लिस्ट देखें और जोड़ने वाला बटन दबाएं। फ़ाइलें एक-एक करके जाती हैं, साथ में गिनती दिखती है। |
| Step 5 | Read the summary | सार पढ़ें |
| Step 5 text | The summary says how many were saved, failed, already there and not matched. Fix the names of the unmatched files and run it again. | सार में लिखा होता है कि कितनी सेव हुईं, कितनी फेल हुईं, कितनी पहले से थीं और कितनी का मेल नहीं मिला। जिनका मेल नहीं मिला उनके नाम सुधारकर फिर चलाएं। |
| Problem 1 | A file is Not attached | कोई फ़ाइल नहीं जुड़ी |
| Fix 1 | The reason is written beside it. No die or copy has that code, the file type is not an image, PDF, CDR or DWG, or two dies share the section code. Attach that one from the die itself. | वजह उसके बगल में लिखी है। उस कोड की कोई die या कॉपी नहीं है, फ़ाइल का प्रकार इमेज, PDF, CDR या DWG नहीं है, या दो die का सेक्शन कोड एक है। उसे die से खुद जोड़ें। |
| Problem 2 | Some files failed | कुछ फ़ाइलें फेल हो गईं |
| Fix 2 | The connection dropped. Tap the retry button. The files already saved are not sent again. | कनेक्शन टूट गया था। फिर कोशिश वाला बटन दबाएं। जो सेव हो चुकी हैं वो दोबारा नहीं भेजी जातीं। |
| Problem 3 | A file is too big | फ़ाइल बहुत बड़ी है |
| Fix 3 | A PDF can be up to 25 MB, a CDR or DWG up to 40 MB and an image up to 8 MB. | PDF 25 MB तक, CDR या DWG 40 MB तक और इमेज 8 MB तक हो सकती है। |

### Start a dispatch from a sales order (`dispatch-from-order`)

| Part | English | हिंदी |
|---|---|---|
| Title | Start a dispatch from a sales order | सेल्स ऑर्डर से dispatch शुरू करें |
| When | Use this when a truck is loading for one sales order and you want to see what is left to send as you build the load. | जब ट्रक एक सेल्स ऑर्डर के लिए भर रहा हो और लोड बनाते समय आपको दिखना चाहिए कि कितना भेजना बाकी है। |
| Step 1 | Start from the order | ऑर्डर से शुरू करें |
| Step 1 text | Open "Dispatch" and tap "New dispatch". Tap "From sales order" and search the order by number, PO or customer. The order's customer becomes the dispatch's customer. | "Dispatch" खोलें और "नया dispatch" दबाएं। "सेल्स ऑर्डर से" दबाएं और ऑर्डर को नंबर, PO या ग्राहक से खोजें। ऑर्डर का ग्राहक ही dispatch का ग्राहक बन जाता है। |
| Step 2 | Create it | बनाएं |
| Step 2 text | Set the ship date if you know it and tap "Create dispatch". | शिप की तारीख पता हो तो डालें और "Dispatch बनाएं" दबाएं। |
| Step 3 | Let orrn suggest bundles | orrn से bundle सुझवाएं |
| Step 3 text | Tap "Suggest bundles". orrn lists this order's own stock first, then plant stock of the same die and length. Tick what you want, or add all that fit within the baki. | "Bundle सुझाएं" दबाएं। orrn पहले इसी ऑर्डर का स्टॉक दिखाता है, फिर उसी die और लंबाई का प्लांट स्टॉक। जो चाहिए चुनें, या बाकी में जितना समाए सब जोड़ दें। |
| Step 4 | Or scan | या स्कैन करें |
| Step 4 text | Scanning works as usual. Each bundle is linked to the order line it belongs to. The panel shows the baki now, what is on this load and what is left after it. | स्कैन पहले की तरह चलता है। हर bundle अपनी ऑर्डर लाइन से जुड़ जाता है। पैनल में अभी का बाकी, इस लोड का और इसके बाद बचा हुआ दिखता है। |
| Step 5 | Watch the lines | लाइनें देखें |
| Step 5 text | Each line shows its baki, the load and what is left. A line that goes past its baki says by how many kg. A bundle whose kg/12ft is far from the line's is marked, and you can still add it. | हर लाइन अपना बाकी, लोड और बचा हुआ दिखाती है। जो लाइन अपने बाकी से आगे निकल जाए वो बताती है कि कितने kg ज़्यादा हैं। जिस bundle का kg/12ft लाइन से बहुत अलग हो उस पर निशान लगता है, और फिर भी जोड़ा जा सकता है। |
| Step 6 | Hold and dispatch | होल्ड और dispatch |
| Step 6 text | Then "Hold stock" and "Dispatch" as in the other dispatch guide. The packing list comes out with the order and PO on each group. | फिर दूसरे dispatch गाइड की तरह "स्टॉक होल्ड करें" और "Dispatch करें"। पैकिंग लिस्ट में हर ग्रुप पर ऑर्डर और PO आता है। |
| Problem 1 | A bundle is refused for being outside the order | Bundle को ऑर्डर से बाहर का कहकर मना किया |
| Fix 1 | If the plant sends one sales order per packing list, a bundle on another order or of a die this order does not have is refused. Use a bundle of this order or plant stock of the same die. | प्लांट एक पैकिंग लिस्ट पर एक सेल्स ऑर्डर भेजता हो तो दूसरे ऑर्डर का bundle, या ऐसी die का bundle जो इस ऑर्डर में नहीं है, मना कर दिया जाता है। इस ऑर्डर का bundle लें, या उसी die का प्लांट स्टॉक। |
| Problem 2 | More than the order is being sent | ऑर्डर से ज़्यादा जा रहा है |
| Fix 2 | orrn allows a small tolerance on each line. Past it, completing the dispatch asks a manager to approve. Remove bundles or ask the manager. | orrn हर लाइन पर थोड़ी छूट देता है। उससे ऊपर dispatch पूरा करने पर मैनेजर की मंज़ूरी मांगी जाती है। Bundle हटाएं या मैनेजर से कहें। |
| Problem 3 | A bundle is held for another order | Bundle किसी दूसरे ऑर्डर के लिए होल्ड है |
| Fix 3 | It is held for another customer's line. Choose another bundle, or ask the office to release the hold. | वो किसी दूसरे ग्राहक की लाइन के लिए होल्ड है। दूसरा bundle चुनें, या ऑफिस से होल्ड हटवाएं। |

### Set the truck, driver and capacity (`truck-capacity`)

| Part | English | हिंदी |
|---|---|---|
| Title | Set the truck, driver and capacity | ट्रक, ड्राइवर और क्षमता तय करें |
| When | Use this before a truck leaves, so the vehicle is on the packing list and the load does not go over what the truck can carry. | ट्रक निकलने से पहले, ताकि गाड़ी पैकिंग लिस्ट पर आए और लोड ट्रक की क्षमता से ऊपर न जाए। |
| Step 1 | Open the dispatch | Dispatch खोलें |
| Step 1 text | Open "Dispatch" and tap the dispatch. Tap "Edit details". | "Dispatch" खोलें और dispatch दबाएं। "जानकारी बदलें" दबाएं। |
| Step 2 | Fill the vehicle | गाड़ी भरें |
| Step 2 text | Type the "Vehicle number", the driver and the driver's phone. Pick the transporter, or add one with "Add transporter". The vehicle number and driver print on the packing list. | "गाड़ी नंबर", ड्राइवर और ड्राइवर का फ़ोन लिखें। ट्रांसपोर्टर चुनें, या "ट्रांसपोर्टर जोड़ें" से नया डालें। गाड़ी नंबर और ड्राइवर पैकिंग लिस्ट पर छपते हैं। |
| Step 3 | Set the capacity | क्षमता डालें |
| Step 3 text | Type the "Truck capacity (kg)". The page shows how full the truck is as you add bundles. Leave it blank for no warning. | "गाड़ी की क्षमता (kg)" लिखें। bundle जोड़ते समय पेज दिखाता है कि ट्रक कितना भरा है। चेतावनी नहीं चाहिए तो खाली छोड़ें। |
| Step 4 | Save | सेव करें |
| Step 4 text | Tap "Save details". The capacity is a warning while you load. It does not stop you adding bundles. | "जानकारी सेव करें" दबाएं। क्षमता लोड करते समय सिर्फ चेतावनी है। वो bundle जोड़ने से नहीं रोकती। |
| Step 5 | If it goes over | ऊपर चला जाए तो |
| Step 5 text | When the load is over capacity, orrn asks you to say why before you can dispatch. The reason is kept with the dispatch. | लोड क्षमता से ऊपर हो तो dispatch करने से पहले orrn वजह लिखने को कहता है। वजह dispatch के साथ रहती है। |
| Problem 1 | Several customers are on one truck | एक ट्रक पर कई ग्राहक हैं |
| Fix 1 | If the plant allows it, tap "Add another customer to this truck". Each customer keeps its own packing list. The vehicle, driver and capacity belong to the truck, and the capacity counts the whole truck. | प्लांट इसकी छूट देता हो तो "इस ट्रक में एक और ग्राहक जोड़ें" दबाएं। हर ग्राहक की अपनी पैकिंग लिस्ट रहती है। गाड़ी, ड्राइवर और क्षमता ट्रक की होती है, और क्षमता में पूरा ट्रक गिना जाता है। |
| Problem 2 | I changed the capacity after the dispatch | dispatch के बाद क्षमता बदल दी |
| Fix 2 | The capacity this load went against stays as it was. orrn keeps it with the dispatch. | जिस क्षमता के सामने ये लोड गया था वो वैसी ही रहती है। orrn उसे dispatch के साथ रखता है। |
| Problem 3 | The vehicle number looks different | गाड़ी का नंबर अलग दिख रहा है |
| Fix 3 | orrn drops spaces and dashes and keeps only letters and digits, so a number typed with spaces is stored without them. | orrn खाली जगह और डैश हटा देता है और सिर्फ अक्षर व अंक रखता है, इसलिए खाली जगह के साथ लिखा नंबर बिना खाली जगह के सेव होता है। |

### Correct a packing list with a new revision (`packing-list-revisions`)

| Part | English | हिंदी |
|---|---|---|
| Title | Correct a packing list with a new revision | पैकिंग लिस्ट सुधारें: नया रिवीज़न बनाएं |
| When | Use this when a packing list that was already sent needs to change, for example a bundle was swapped or a weight was corrected. | जब भेजी जा चुकी पैकिंग लिस्ट में बदलाव करना हो, जैसे कोई bundle बदला या वज़न सुधारा गया। |
| Step 1 | Open the packing list | पैकिंग लिस्ट खोलें |
| Step 1 text | Open "Dispatch", open the completed dispatch and open its packing list. | "Dispatch" खोलें, पूरा हो चुका dispatch खोलें और उसकी पैकिंग लिस्ट खोलें। |
| Step 2 | Look at what is sent | देखें क्या भेजा गया है |
| Step 2 text | The list shows its revision number. A revision that was already sent stays readable and is marked "Sent earlier". | लिस्ट अपना रिवीज़न नंबर दिखाती है। जो रिवीज़न भेजा जा चुका है वो पढ़ा जा सकता है और उस पर "पहले भेजा गया" लिखा होता है। |
| Step 3 | Make the revision | रिवीज़न बनाएं |
| Step 3 text | Tap "Make a new revision" and confirm. orrn builds the list again from the bundles as they are now. The PL number does not change. | "नया संशोधन बनाएं" दबाएं और पक्का करें। orrn लिस्ट को bundle की अभी की हालत से फिर बनाता है। PL नंबर नहीं बदलता। |
| Step 4 | Check what changed | बदलाव जांचें |
| Step 4 text | The page lists the changes from the earlier revision: bundles added, removed or changed. Read them before you send. | पेज पिछले रिवीज़न से बदलावों की लिस्ट दिखाता है: कौन से bundle जुड़े, हटे या बदले। भेजने से पहले इन्हें पढ़ें। |
| Step 5 | Print and send | प्रिंट करें और भेजें |
| Step 5 text | Download the PDF or Excel as usual. Tell the customer that this revision replaces the one sent before. | PDF या Excel पहले की तरह डाउनलोड करें। ग्राहक को बता दें कि ये रिवीज़न पहले भेजे गए की जगह लेता है। |
| Problem 1 | There is no Make a new revision button | नया रिवीज़न बनाने का बटन नहीं है |
| Fix 1 | Only people who can complete a dispatch can make one. A list that was combined with others cannot be remade from its parts. | सिर्फ वो लोग बना सकते हैं जो dispatch पूरा कर सकते हैं। दूसरों से मिलाई गई लिस्ट अपने हिस्सों से दोबारा नहीं बनती। |
| Problem 2 | The number on the list looks wrong | लिस्ट का कोई आंकड़ा गलत लग रहा है |
| Fix 2 | Make sure the dispatch holds the right bundles first. A new revision reads the bundles as they are now, so a wrong bundle gives a wrong list. | पहले देखें कि dispatch में सही bundle हैं। नया रिवीज़न bundle को अभी की हालत में पढ़ता है, इसलिए गलत bundle से लिस्ट गलत ही बनेगी। |
| Problem 3 | I need to see the old list | मुझे पुरानी लिस्ट देखनी है |
| Fix 3 | Open "Revisions" and pick the earlier one. Nothing is deleted. | "रिवीज़न" खोलें और पहले वाला चुनें। कुछ मिटाया नहीं जाता। |

### Combine packing lists into one (`combine-packing-lists`)

| Part | English | हिंदी |
|---|---|---|
| Title | Combine packing lists into one | कई पैकिंग लिस्ट एक में मिलाएं |
| When | Use this when one customer's trucks went out on different days and they want one list for all of them. | जब एक ग्राहक के ट्रक अलग-अलग दिन गए हों और उन्हें सबकी एक ही लिस्ट चाहिए। |
| Step 1 | Open one of the lists | कोई एक लिस्ट खोलें |
| Step 1 text | Open "Dispatch", open a completed dispatch of the customer and open its packing list. | "Dispatch" खोलें, ग्राहक का पूरा हो चुका dispatch खोलें और उसकी पैकिंग लिस्ट खोलें। |
| Step 2 | Start the combine | मिलाना शुरू करें |
| Step 2 text | Tap "Combine lists". orrn shows the customer's other lists that are not already combined. | "लिस्ट मिलाएं" दबाएं। orrn ग्राहक की वो दूसरी लिस्ट दिखाता है जो अभी तक मिलाई नहीं गई हैं। |
| Step 3 | Pick the lists | लिस्ट चुनें |
| Step 3 text | Tick the lists to fold in. All must belong to the same customer and to completed dispatches. | जिन लिस्ट को जोड़ना है उन पर निशान लगाएं। सब एक ही ग्राहक की और पूरे हो चुके dispatch की होनी चाहिए। |
| Step 4 | Combine | मिलाएं |
| Step 4 text | Tap the combine button. The new list takes a new PL number. Each folded list keeps its own number and shows "Combined". | मिलाने वाला बटन दबाएं। नई लिस्ट को नया PL नंबर मिलता है। जोड़ी गई हर लिस्ट अपना नंबर रखती है और उस पर "मिलाया गया" दिखता है। |
| Step 5 | Print it | प्रिंट करें |
| Step 5 text | Download the PDF or Excel of the new list. It carries every bundle from the folded lists, grouped by order line. | नई लिस्ट का PDF या Excel डाउनलोड करें। उसमें जोड़ी गई सब लिस्ट के सारे bundle ऑर्डर लाइन के हिसाब से ग्रुप में होते हैं। |
| Problem 1 | No other list to combine | मिलाने के लिए कोई दूसरी लिस्ट नहीं है |
| Fix 1 | The customer has no other completed, uncombined list. Check that the other dispatch is completed. | ग्राहक की कोई और पूरी हुई, बिना मिलाई लिस्ट नहीं है। देखें कि दूसरा dispatch पूरा हुआ है या नहीं। |
| Problem 2 | I combined the wrong lists | गलत लिस्ट मिल गईं |
| Fix 2 | A combined list cannot be undone or remade from its parts. Ask a manager before you combine. | मिलाई हुई लिस्ट वापस नहीं की जा सकती और अपने हिस्सों से दोबारा नहीं बनती। मिलाने से पहले मैनेजर से पूछ लें। |
| Problem 3 | A list is missing the vehicle | किसी लिस्ट में गाड़ी नहीं है |
| Fix 3 | Each folded list kept its own header. Open the truck's own dispatch to correct a vehicle, then make a new revision of that list. | जोड़ी गई हर लिस्ट ने अपना हेडर रखा है। गाड़ी ठीक करने के लिए उस ट्रक का अपना dispatch खोलें, फिर उस लिस्ट का नया रिवीज़न बनाएं। |

### Settle a closed stock count (`settle-count`)

| Part | English | हिंदी |
|---|---|---|
| Title | Settle a closed stock count | बंद हुई स्टॉक गिनती का निपटारा करें |
| When | Use this after a count is closed, to deal with the bundles that were missing or found in the wrong yard. | गिनती बंद होने के बाद, जब गुम हुए या गलत यार्ड में मिले bundle का हिसाब करना हो। |
| Step 1 | Open the closed count | बंद गिनती खोलें |
| Step 1 text | Open "Stock", then "Stock count", and open the closed count under "Earlier counts". | "स्टॉक" खोलें, फिर "स्टॉक की गिनती", और "पिछली गिनतियां" में से बंद गिनती खोलें। |
| Step 2 | Read the report | रिपोर्ट पढ़ें |
| Step 2 text | The report shows what was missing, found and moved, and the difference by yard and by section. Bundles packed or moved during the count are not counted as missing. | रिपोर्ट में दिखता है कि क्या गुम है, क्या मिला और क्या अपनी जगह से हटा था, और यार्ड व सेक्शन के हिसाब से फर्क। गिनती के दौरान पैक या मूव हुए bundle गुम नहीं गिने जाते। |
| Step 3 | Move what was found | जो मिला उसे मूव करें |
| Step 3 text | For bundles found in another yard, use the move button. They go to the yard where they were seen, and the move is on the ledger. | दूसरे यार्ड में मिले bundle के लिए मूव बटन इस्तेमाल करें। वो उस यार्ड में चले जाते हैं जहां दिखे थे, और मूव लेजर में दर्ज होता है। |
| Step 4 | Ask to void what is really gone | जो सच में गया उसे रद्द करवाएं |
| Step 4 text | Look again in the nearby yards. For bundles that are truly missing, ask to void them. A manager is asked to approve. Until then they stay in stock. | आस-पास के यार्ड फिर देखें। जो bundle सच में गुम हैं उन्हें रद्द करने के लिए कहें। मैनेजर से मंज़ूरी मांगी जाती है। तब तक वो स्टॉक में रहते हैं। |
| Step 5 | Check the number | आंकड़ा जांचें |
| Step 5 text | The missing figure on Today and on "Stock count" falls as bundles are voided, found or cleared. | Today पर और "स्टॉक की गिनती" में गुम का आंकड़ा तब घटता है जब bundle रद्द होते हैं, मिलते हैं या साफ किए जाते हैं। |
| Problem 1 | The bundle was seen in another count | Bundle किसी दूसरी गिनती में दिखा था |
| Fix 1 | A bundle that another count saw is not missing. The report says where. Move it from that count instead of voiding it. | जो bundle किसी और गिनती ने देखा वो गुम नहीं है। रिपोर्ट बताती है कहां। उसे रद्द करने की जगह उसी गिनती से मूव करें। |
| Problem 2 | The approval was refused | मंज़ूरी नामंज़ूर हो गई |
| Fix 2 | The bundle was packed or moved after the count closed, so it is no longer missing. Nothing is voided. | गिनती बंद होने के बाद वो bundle पैक या मूव हुआ, इसलिए अब गुम नहीं है। कुछ रद्द नहीं होता। |
| Problem 3 | Closing a count did not change the stock | गिनती बंद करने से स्टॉक नहीं बदला |
| Fix 3 | That is right. Closing freezes the report. Only an approved void or a move changes the ledger. | यही सही है। बंद करने से सिर्फ रिपोर्ट जम जाती है। लेजर सिर्फ मंज़ूर रद्दीकरण या मूव से बदलता है। |

### Give a customer a party login (`portal-login`)

| Part | English | हिंदी |
|---|---|---|
| Title | Give a customer a party login | ग्राहक को पार्टी लॉगिन दें |
| When | Use this when a customer should see their own dies, book orders and see what was dispatched to them. | जब ग्राहक को अपनी die देखनी हों, ऑर्डर बुक करने हों और देखना हो कि उसे क्या भेजा गया। |
| Step 1 | Turn the portal on | पोर्टल चालू करें |
| Step 1 text | Open "Settings" and turn on "Party portal" in the switches. This is once for the plant. | "सेटिंग्स" खोलें और स्विच में "पार्टी पोर्टल" चालू करें। ये प्लांट के लिए एक बार करना है। |
| Step 2 | Open the customer | ग्राहक खोलें |
| Step 2 text | Open "Customers" and open the party. Find "Portal access". | "ग्राहक" खोलें और पार्टी को खोलें। "पोर्टल एक्सेस" ढूंढें। |
| Step 3 | Give a login | लॉगिन दें |
| Step 3 text | Tap "Give a login", type the party's email and tap "Give login". orrn makes an invite link that works for 7 days. | "लॉगिन दें" दबाएं, पार्टी का ईमेल लिखें और "लॉगिन दें" दबाएं। orrn 7 दिन चलने वाला इनवाइट लिंक बनाता है। |
| Step 4 | Send the link | लिंक भेजें |
| Step 4 text | Copy the invite link with "Copy link" and send it to the party. Email is not always reliable, so send the link yourself. | "लिंक कॉपी करें" से इनवाइट लिंक कॉपी करके पार्टी को भेजें। ईमेल हमेशा भरोसेमंद नहीं होता, इसलिए लिंक खुद भेजें। |
| Step 5 | Open the dies | Die खोलें |
| Step 5 text | Under "Dies the party sees" tap "Open a die" for each die the party may book. A die owned by another customer is never shown. | "पार्टी को दिखने वाले die" में हर उस die के लिए "Die खोलें" दबाएं जो पार्टी बुक कर सकती है। किसी दूसरे ग्राहक की die कभी नहीं दिखती। |
| Step 6 | Turn it off if needed | ज़रूरत हो तो बंद करें |
| Step 6 text | Tap "Turn off" to stop a login. "Turn on" brings it back with no new invite. | लॉगिन रोकने के लिए "बंद करें" दबाएं। "चालू करें" उसे बिना नए इनवाइट के लौटा देता है। |
| Problem 1 | This email is a plant login | ये ईमेल प्लांट का लॉगिन है |
| Fix 1 | A person cannot be staff and a party in the same plant. Use another email for the party. | एक ही प्लांट में कोई आदमी स्टाफ और पार्टी दोनों नहीं हो सकता। पार्टी के लिए दूसरा ईमेल इस्तेमाल करें। |
| Problem 2 | The party sees no dies | पार्टी को कोई die नहीं दिखती |
| Fix 2 | A party sees the dies it owns and those you open for it. Open the dies, and check the party portal switch. | पार्टी को अपनी die और वो die दिखती हैं जो आपने उसके लिए खोली हैं। die खोलें और पार्टी पोर्टल का स्विच देखें। |
| Problem 3 | The party books an order | पार्टी ने ऑर्डर बुक किया |
| Fix 3 | It arrives as "Booking" marked Portal. Open it, check the lines and confirm it like any other order. | वो "बुकिंग" बनकर आता है और उस पर "पोर्टल" लिखा होता है। उसे खोलें, लाइनें जांचें और बाकी ऑर्डर की तरह पक्का करें। |

### Issue a test certificate (`issue-certificate`)

| Part | English | हिंदी |
|---|---|---|
| Title | Issue a test certificate | टेस्ट सर्टिफिकेट जारी करें |
| When | Use this when a customer needs a test certificate for a dispatch that has gone out. | जब ग्राहक को ऐसे dispatch का टेस्ट सर्टिफिकेट चाहिए जो निकल चुका है। |
| Step 1 | Open the dispatch | Dispatch खोलें |
| Step 1 text | Open "Dispatch", and open the completed dispatch. | "Dispatch" खोलें, और पूरा हो चुका dispatch खोलें। |
| Step 2 | Issue it | जारी करें |
| Step 2 text | Tap "Issue test certificate". The certificate takes the next number and cites the casts behind the bundles with each cast's chemistry. | "टेस्ट सर्टिफिकेट जारी करें" दबाएं। सर्टिफिकेट को अगला नंबर मिलता है और उसमें bundle के पीछे की कास्ट और हर कास्ट की केमिस्ट्री आती है। |
| Step 3 | Read the chemistry | केमिस्ट्री पढ़ें |
| Step 3 text | Casts that have not been tested yet are shown as pending. orrn never invents a figure. | जिन कास्ट की जाँच नहीं हुई वो बाकी दिखती हैं। orrn कोई आंकड़ा अपने मन से नहीं भरता। |
| Step 4 | The customer sees it | ग्राहक देखता है |
| Step 4 text | If the customer has a party login, the certificate shows under the dispatch in their portal. It carries no rate. | ग्राहक के पास पार्टी लॉगिन हो तो सर्टिफिकेट उसके पोर्टल में dispatch के नीचे दिखता है। उसमें कोई रेट नहीं होता। |
| Step 5 | Issue again | फिर से जारी करें |
| Step 5 text | If something changed, tap "Issue again". The new revision keeps the same certificate number. | कुछ बदला हो तो "फिर से जारी करें" दबाएं। नया रिवीज़न वही सर्टिफिकेट नंबर रखता है। |
| Problem 1 | Chemistry pending | केमिस्ट्री बाकी है |
| Fix 1 | No spectrometer result is attached to the cast yet. The foundry attaches it. Issue again when it is there. | कास्ट के साथ अभी कोई स्पेक्ट्रोमीटर नतीजा नहीं जुड़ा। फाउंड्री उसे जोड़ती है। जुड़ने पर फिर से जारी करें। |
| Problem 2 | Some bundles have no cast number | कुछ bundle पर कास्ट नंबर नहीं है |
| Fix 2 | The certificate says how many. Those bundles were packed without a cast. | सर्टिफिकेट बताता है कितने। वो bundle बिना कास्ट के पैक हुए थे। |
| Problem 3 | There is no button | बटन नहीं है |
| Fix 3 | Only the office, a manager, an admin or the owner can issue it, or a person who can complete dispatches. | इसे सिर्फ ऑफिस, मैनेजर, एडमिन या मालिक जारी कर सकता है, या वो जो dispatch पूरा कर सकता है। |

### Manage the reason codes (`reason-codes`)

| Part | English | हिंदी |
|---|---|---|
| Title | Manage the reason codes | रीज़न कोड संभालें |
| When | Use this when the floor needs a new reason in a list, such as why a press stopped or why a bundle was voided. | जब फ्लोर को किसी लिस्ट में नई वजह चाहिए, जैसे प्रेस क्यों रुकी या bundle क्यों रद्द हुआ। |
| Step 1 | Open the reasons | वजहें खोलें |
| Step 1 text | Open "Masters" and the reason codes page. Pick the kind of reason: downtime, rejects, void, reprint or move to another order. | "मास्टर" और रीज़न कोड का पेज खोलें। वजह का प्रकार चुनें: रुकना, रिजेक्ट, रद्द, फिर से प्रिंट या दूसरे ऑर्डर पर डालना। |
| Step 2 | Add a reason | वजह जोड़ें |
| Step 2 text | Add the reason in English. Type the Hindi and Gujarati words too, so the floor sees it in their language. The key is made from the English words once and never changes. | वजह अंग्रेज़ी में जोड़ें। हिंदी और गुजराती शब्द भी लिखें, ताकि फ्लोर को अपनी भाषा में दिखे। कुंजी अंग्रेज़ी शब्दों से एक बार बनती है और कभी नहीं बदलती। |
| Step 3 | Ask for a note if needed | ज़रूरत हो तो नोट मांगें |
| Step 3 text | Switch on the note box for a reason that needs explaining. Other is fixed in every kind. It always asks for a note. | जिस वजह को समझाना ज़रूरी हो उस पर नोट का खाना चालू करें। Other हर प्रकार में तय है। वो हमेशा नोट मांगता है। |
| Step 4 | Rename or retire | नाम बदलें या बंद करें |
| Step 4 text | Renaming changes the words, not the key. A retired reason leaves the pickers but stays on old records. It can be turned on again. | नाम बदलने से शब्द बदलते हैं, कुंजी नहीं। बंद की हुई वजह चुनने की लिस्ट से हट जाती है पर पुराने रिकॉर्ड पर रहती है। उसे फिर चालू किया जा सकता है। |
| Problem 1 | A standard reason shows in English | मानक वजह अंग्रेज़ी में दिख रही है |
| Fix 1 | A reason you renamed shows the words you typed. Type the Hindi and Gujarati words for it. | जिस वजह का आपने नाम बदला वो आपके लिखे शब्द दिखाती है। उसके हिंदी और गुजराती शब्द भी लिखें। |
| Problem 2 | I cannot rename Other | Other का नाम नहीं बदल सकता |
| Fix 2 | Other is fixed so that there is always a way out. Add a more exact reason instead. | Other इसलिए तय है कि बाहर निकलने का रास्ता हमेशा रहे। उसकी जगह ज़्यादा सटीक वजह जोड़ें। |
| Problem 3 | Nothing changes on the tablet | टैबलेट पर कुछ नहीं बदला |
| Fix 3 | The list loads when the press page opens. Reload the page. | लिस्ट प्रेस पेज खुलते समय लोड होती है। पेज फिर से लोड करें। |
