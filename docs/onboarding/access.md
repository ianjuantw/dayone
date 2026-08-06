# Developer access checklist

DayOne does not query GitHub, a messaging platform, or a credential manager. The connected access step is a self-acknowledgement checklist. Confirm each item only after checking it yourself:

- you can open and clone `ianjuantw/dayone`;
- Git authenticates with the account you intend to use;
- you know where to raise a repository question or blocker;
- you know who should review your first pull request.

The journey stores only the acknowledgement state. It must never store credentials, tokens, secret values, or private key material. Repository write permission is not automatically verified; a push or pull request can still fail if your GitHub account lacks permission.
