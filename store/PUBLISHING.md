# Publishing Largo Ad Blocker on the Chrome Web Store

These steps are done by hand with your own Google account. About 20 minutes, plus Google's review.

## 1. Developer account (first time only)

1. Go to https://chrome.google.com/webstore/devconsole with the Google account you want to publish
   from (your personal one, not the work one).
2. Accept the developer agreement and pay the one-time **US$5** registration fee by card.
3. Under **Account**, fill in the publisher name people will see (for example "Largo") and a
   **contact email**. Google verifies it with a link; you can't publish until it's verified.
4. If you're asked to verify your identity or turn on 2-Step Verification, do it: it's required.
5. Declare whether you are a "trader" (EU Digital Services Act). For a free personal extension,
   choose that you are **not** a trader.

## 2. Privacy policy

Already done: the repo is public and the policy is at
https://github.com/jorgediazlargo/libreadblocker/blob/main/PRIVACY.md

## 3. Create the item

1. `pnpm package` in `~/dev/personal/libreadblocker` → `largo-ad-blocker-0.1.0.zip`.
2. In the dashboard: **New item** → upload the zip.
3. Fill in the tabs with the content of `store/LISTING.md`:
   - **Store listing:** English description, category, images from `images/en/`. Then switch the
     language to Spanish and paste the Spanish description and the images from `images/es/`.
   - **Privacy practices:** single purpose, justification for each permission, remote code (no),
     data usage and privacy policy URL.
   - **Distribution:** public, all regions.
4. Click **Submit for review**. You can tick "publish automatically after approval" or publish it
   yourself once it's approved.

## 4. Review

- Because it asks for access to all sites (`<all_urls>`), Google does an **in-depth review**: expect
  several days, sometimes a couple of weeks. You'll get an email.
- If it's rejected, the email names the specific policy (violation code). Fix it and resubmit.

## 5. Updates

1. Bump `version` in `package.json` (the store rejects a zip with the same version).
2. `pnpm update-lists && pnpm package` to bring the filter lists up to date.
3. Dashboard → the item → **Package → Upload new package** → Submit for review.

The filter lists ship inside the package (Manifest V3 doesn't allow downloading rules), so users
only get fresh filters when you publish a new version; about once a month is reasonable.
