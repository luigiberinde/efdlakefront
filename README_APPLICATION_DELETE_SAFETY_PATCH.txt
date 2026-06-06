Application delete safety patch

Files to copy:
- components/ShiftBoard.js -> components/ShiftBoard.js
- app/api/apply-shift/route.js -> app/api/apply-shift/route.js
- app/api/delete-own-shift/route.js -> app/api/delete-own-shift/route.js
- app/api/delete-application/route.js -> app/api/delete-application/route.js

What it does:
- If a user applies to their own shift, blocks the application and offers to delete their shift posting.
- If a user applies to a shift they already applied for, blocks the duplicate and offers to delete their existing pending application.
- Adds an LC-only delete application button in LC review.
- Does not delete anything automatically. Deletion only happens after confirmation/click.
- Does not require SQL changes.

Testing:
1. Try applying to your own open shift. You should get a modal offering to delete your posting.
2. Apply once to someone else's shift, then try applying again with the same email. You should get a modal offering to delete your existing application.
3. In LC review, click Delete app on a pending application. It should delete only that application, not the shift.
