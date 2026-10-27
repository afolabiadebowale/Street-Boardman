# StreetBoardman — Better User Manual

## 1. What is StreetBoardman?

StreetBoardman turns the local "Boardman" you already know — the person who
runs betting on street football, snooker, pool and other local competitions
— into a digital app. Instead of handing over cash and trusting memory,
your bets, your money, and the result are all recorded in the app.

**Everything in this version runs on DEMO money.** No real cash is at risk
yet — you're using test funds so you can learn the app safely.

## 2. How to Register

1. Open the app.
2. Tap **BETTER** — "Place bets on local competitions".
3. Enter your full name, phone number, and choose a PIN (at least 4
   digits/characters). Remember this PIN — it's how you log in.
4. Tap **Register**. You're taken straight to your Better home screen.

## 3. How to Log In

1. Tap **Log In** on the welcome screen.
2. Enter your phone number and PIN.
3. Tap **Log In**.

## 4. How to Deposit

1. From your home screen or Wallet tab, tap **Deposit**.
2. Enter the amount.
3. Tap **Deposit**. The demo money lands in your wallet instantly.

*(In a future real-money version, this step will use a payment provider
like Paystack, and the money only shows up once the payment is verified —
never before.)*

## 5. How to Browse Competitions

Tap the **Bet** tab to see every competition currently open for betting.
Each one shows:
- The title (e.g. "Tunde vs Seyi")
- The category (football, snooker, etc.)
- When betting closes

Tap a competition to see the full betting options.

## 6. How to Place a Bet

1. Open a competition.
2. Choose one option (e.g. "Tunde wins").
3. Enter your stake (minimum NGN 100).
4. Tap **Place Bet**.

The app checks your wallet balance and whether betting is still open
before accepting your bet. If everything is fine, your stake is deducted
immediately and you get a digital ticket.

## 7. How to View a Betting Ticket

Every bet gets a unique **Bet ID** (e.g. `SB-000123`). Your ticket shows:

```
BET ID: SB-000123
Competition: Tunde vs Seyi
Selection: Tunde wins
Stake: NGN 5,000
Estimated payout: NGN 9,200
Status: OPEN
```

**Important:** the "Estimated payout" is just that — an estimate. It can
change until betting closes, because it depends on how much everyone else
stakes on each side. Your exact winnings are only confirmed after the
result is settled. Find your tickets any time under **My Bets**.

## 8. How to Check Results

Your bet's status changes as things move forward:
- **OPEN** — competition still in progress or awaiting result.
- **WON** — you picked correctly, your wallet has been credited.
- **LOST** — the other side won.
- **REFUNDED** — the competition was cancelled; you got your stake back.

## 9. How Winnings Work

When the Boardman submits a result, it isn't paid out immediately — there's
a short **confirmation window** (the Boardman or Admin sets this, typically
a couple of hours) where anyone can flag a problem. If nobody disputes it,
winnings are calculated and paid into winners' wallets automatically.

Winnings come from the total pool staked on the competition, minus the
Boardman's and the Platform's commission, shared among winners in
proportion to how much each of them staked on the winning side.

Two cases where **everyone gets their full stake back and no commission is
taken**: if every bet is on the same side, or if the winning option is one
nobody bet on. A competition's page warns you while either could happen.

Each competition's page shows the live pool: how much is on each side and
roughly what ₦100 on that side would return if it won. It changes as bets
come in, so treat it as an estimate.

You can also see the Boardman running it: where they operate, how many
competitions they've completed, and a **trust score** once they've settled
at least five. The score drops when a result of theirs is thrown out after
a dispute, and a little when they cancel a competition.

## 10. How to Withdraw

1. Go to **Wallet -> Withdraw**.
2. Enter the amount and your bank details.
3. Tap **Request Withdrawal**.

The amount is held from your wallet immediately so you can't spend it
twice while it's processing.

## 11. Transaction History

**Wallet -> Transaction History** shows every deposit, stake, win, refund
and withdrawal, in order, with the running balance after each one — so you
can always account for every naira in your wallet.

## 12. What Happens When a Competition Is Disputed

If someone flags a problem with a result during the confirmation window,
the competition is marked **DISPUTED** and all payouts on it are frozen —
even if you won. A Platform Admin reviews the dispute and either:
- **Confirms** the result (payouts then proceed), or
- **Cancels the competition** (everyone's stake is refunded, no winners or
  losers).

You'll see the outcome reflected on your bet's status once it's resolved.

## 13. Account Security

- Never share your PIN with anyone, including someone claiming to be
  support or a Boardman.
- Your session is protected by a secure cookie set by our server — nobody
  can see or guess it just by using the app.
- If you think your account has been compromised, contact support
  immediately so it can be suspended.

## 13a. Your Data and Privacy

The buttons for these arrive in the next app update; until then, ask support.

- **Download your data:** you can get a file with everything we hold about you: profile, wallet history, bets, deposits, withdrawals, identity-check results and notifications.
- **Delete your account:** you can delete your account, confirming with your PIN. Withdraw your balance first and let any open bets settle. Your name, phone number and other personal details are removed and you're signed out everywhere. Records of past payments and bets are kept, without your name, because the law requires us to keep financial records.
- **Terms and privacy policy:** when they change, you'll be asked to accept the new version before your next bet or deposit.

## 14. Frequently Asked Questions

**Is this real money?**
Not yet. This version runs entirely on demo/test funds while the app is
built and reviewed. Real-money betting will only be switched on after
legal, regulatory and payment checks are complete.

**Why did my estimated payout change after I placed my bet?**
Because more bets came in on either side, changing the pool. Your final
payout is only locked in once the result is confirmed.

**What's the minimum bet?**
NGN 100.

**Can I cancel a bet after placing it?**
No — once placed, a bet is locked in like a real betting ticket. If the
competition itself is cancelled, you're refunded automatically.

**What if the Boardman doesn't submit a result?**
Contact support — this is something the Platform Admin can look into and
resolve.
