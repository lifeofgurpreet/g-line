// The object below is plain JSON, on purpose: another program that reads the same
// policy can copy everything after the "export default" line and run the same cases.
// It is a .ts file only because a mod's tests load code, not .json.
export default
{
  "about": "Off switches and windows: for a policy, an account and a moment, is the account held, and when does the hold let go on its own. g-line's tests run every case (tests/guard.test.ts); anything else that reads the same policy can run them too, so two readers can't drift. Intervals are start inclusive, end exclusive. A range past midnight belongs to the day it starts on. 'lift' is null when nothing ends the hold but a person.",
  "policies": {
    "week_hours": {
      "windows": [
        {
          "accounts": [
            "programmes@example.com",
            "web@example.org"
          ],
          "from": "2026-11-30T00:00:00+08:00",
          "until": "2026-12-05T00:00:00+08:00",
          "hours": "14:00-18:00 mon-fri",
          "tz": "Asia/Kuala_Lumpur",
          "why": "kept for the programme team",
          "end_turn": false
        }
      ]
    },
    "overnight": {
      "windows": [
        {
          "accounts": [
            "night@example.com"
          ],
          "hours": "22:00-06:00 mon-thu",
          "tz": "Asia/Kuala_Lumpur"
        }
      ]
    },
    "until_cuts_hours": {
      "windows": [
        {
          "accounts": [
            "cut@example.com"
          ],
          "until": "2026-12-01T16:00:00+08:00",
          "hours": "14:00-18:00",
          "tz": "Asia/Kuala_Lumpur"
        }
      ]
    },
    "berlin_day": {
      "windows": [
        {
          "accounts": [
            "berlin@example.com"
          ],
          "hours": "09:00-17:00",
          "tz": "Europe/Berlin"
        }
      ]
    },
    "berlin_night": {
      "windows": [
        {
          "accounts": [
            "berlin@example.com"
          ],
          "hours": "01:00-04:00",
          "tz": "Europe/Berlin"
        }
      ]
    },
    "plain": {
      "groups": {
        "team-only": [
          "programmes@example.org"
        ],
        "team": [
          "programmes@",
          "space@"
        ]
      },
      "off": [
        {
          "accounts": [
            "web@example.org"
          ],
          "until": "2026-12-05T00:00:00+08:00",
          "why": "reserved for the team"
        },
        {
          "groups": [
            "team-only"
          ],
          "why": "reserved for the team"
        },
        {
          "accounts": [
            "later@example.com"
          ],
          "from": "2026-12-01T00:00:00Z"
        },
        {
          "accounts": [
            "hq@"
          ],
          "until": "2026-11-20T00:00:00Z"
        }
      ]
    },
    "both_lists": {
      "off": [
        {
          "accounts": [
            "web@example.org"
          ],
          "until": "2026-12-02T00:00:00+08:00",
          "why": "plain switch"
        }
      ],
      "windows": [
        {
          "accounts": [
            "web@example.org"
          ],
          "hours": "14:00-18:00",
          "tz": "Asia/Kuala_Lumpur",
          "why": "window"
        }
      ]
    }
  },
  "cases": [
    {
      "name": "inside the hours of a weekday in range",
      "policy": "week_hours",
      "account": "programmes@example.com",
      "now": "2026-11-30T07:00:00Z",
      "held": true,
      "lift": "2026-11-30T10:00:00Z",
      "why": "kept for the programme team"
    },
    {
      "name": "the start of the hours is in",
      "policy": "week_hours",
      "account": "programmes@example.com",
      "now": "2026-11-30T06:00:00Z",
      "held": true,
      "lift": "2026-11-30T10:00:00Z"
    },
    {
      "name": "a minute before the hours is out",
      "policy": "week_hours",
      "account": "programmes@example.com",
      "now": "2026-11-30T05:59:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "the end of the hours is out",
      "policy": "week_hours",
      "account": "programmes@example.com",
      "now": "2026-11-30T10:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "before from, the same hours on a weekday",
      "policy": "week_hours",
      "account": "programmes@example.com",
      "now": "2026-11-27T07:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "the last afternoon before until",
      "policy": "week_hours",
      "account": "web@example.org",
      "now": "2026-12-04T09:30:00Z",
      "held": true,
      "lift": "2026-12-04T10:00:00Z"
    },
    {
      "name": "after until, the same hours on a weekday",
      "policy": "week_hours",
      "account": "programmes@example.com",
      "now": "2026-12-07T07:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "an account the entry does not name",
      "policy": "week_hours",
      "account": "space@example.com",
      "now": "2026-11-30T07:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "a longer address that contains the named one",
      "policy": "week_hours",
      "account": "max · programmes@example.com",
      "now": "2026-11-30T07:00:00Z",
      "held": true,
      "lift": "2026-11-30T10:00:00Z"
    },
    {
      "name": "in range, outside the hours",
      "policy": "week_hours",
      "account": "programmes@example.com",
      "now": "2026-12-01T19:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "overnight, before midnight",
      "policy": "overnight",
      "account": "night@example.com",
      "now": "2026-12-01T15:00:00Z",
      "held": true,
      "lift": "2026-12-01T22:00:00Z"
    },
    {
      "name": "overnight, after midnight belongs to the day it started",
      "policy": "overnight",
      "account": "night@example.com",
      "now": "2026-12-03T18:00:00Z",
      "held": true,
      "lift": "2026-12-03T22:00:00Z"
    },
    {
      "name": "overnight, Friday night is not named",
      "policy": "overnight",
      "account": "night@example.com",
      "now": "2026-12-04T15:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "overnight, early Monday belongs to Sunday",
      "policy": "overnight",
      "account": "night@example.com",
      "now": "2026-11-29T18:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "until comes before the end of the hours",
      "policy": "until_cuts_hours",
      "account": "cut@example.com",
      "now": "2026-12-01T07:00:00Z",
      "held": true,
      "lift": "2026-12-01T08:00:00Z"
    },
    {
      "name": "after until, inside the hours",
      "policy": "until_cuts_hours",
      "account": "cut@example.com",
      "now": "2026-12-01T08:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "Berlin in winter time",
      "policy": "berlin_day",
      "account": "berlin@example.com",
      "now": "2026-03-28T08:30:00Z",
      "held": true,
      "lift": "2026-03-28T16:00:00Z"
    },
    {
      "name": "Berlin in summer time, the same wall clock an hour earlier in UTC",
      "policy": "berlin_day",
      "account": "berlin@example.com",
      "now": "2026-03-30T07:30:00Z",
      "held": true,
      "lift": "2026-03-30T15:00:00Z"
    },
    {
      "name": "Berlin in summer time, 08:30 on the wall",
      "policy": "berlin_day",
      "account": "berlin@example.com",
      "now": "2026-03-30T06:30:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "the night the clock goes forward: the hours end at 04:00 on the wall",
      "policy": "berlin_night",
      "account": "berlin@example.com",
      "now": "2026-03-29T00:30:00Z",
      "held": true,
      "lift": "2026-03-29T02:00:00Z"
    },
    {
      "name": "the night the clock goes back: the hours end at 04:00 on the wall",
      "policy": "berlin_night",
      "account": "berlin@example.com",
      "now": "2026-10-24T23:30:00Z",
      "held": true,
      "lift": "2026-10-25T03:00:00Z"
    },
    {
      "name": "a plain switch with a time",
      "policy": "plain",
      "account": "web@example.org",
      "now": "2026-11-30T07:00:00Z",
      "held": true,
      "lift": "2026-12-04T16:00:00Z",
      "why": "reserved for the team"
    },
    {
      "name": "a plain switch at its time",
      "policy": "plain",
      "account": "web@example.org",
      "now": "2026-12-04T16:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "a group switch with no time",
      "policy": "plain",
      "account": "programmes@example.org",
      "now": "2026-11-30T07:00:00Z",
      "held": true,
      "lift": null,
      "why": "reserved for the team"
    },
    {
      "name": "the first group that matches decides: this address is in team, not team-only",
      "policy": "plain",
      "account": "programmes@example.com",
      "now": "2026-11-30T07:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "a switch that has not started",
      "policy": "plain",
      "account": "later@example.com",
      "now": "2026-11-30T23:59:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "a switch from its start",
      "policy": "plain",
      "account": "later@example.com",
      "now": "2026-12-01T00:00:00Z",
      "held": true,
      "lift": null
    },
    {
      "name": "a word switch whose time has passed",
      "policy": "plain",
      "account": "hq@example.com",
      "now": "2026-11-30T07:00:00Z",
      "held": false,
      "lift": null
    },
    {
      "name": "a plain switch and a window on one seat: the first written gives the reason and the time",
      "policy": "both_lists",
      "account": "web@example.org",
      "now": "2026-12-01T07:00:00Z",
      "held": true,
      "lift": "2026-12-01T16:00:00Z",
      "why": "plain switch"
    },
    {
      "name": "after the plain switch ends the window still holds in its hours",
      "policy": "both_lists",
      "account": "web@example.org",
      "now": "2026-12-02T07:00:00Z",
      "held": true,
      "lift": "2026-12-02T10:00:00Z",
      "why": "window"
    }
  ]
}
