# License and Trademark Recommendation

> This is a project planning note, not legal advice.

## Recommendation

Use:

- **Apache License 2.0** for source code.
- A separate **trademark policy** for the name `Augustus`, logos, and project identity.
- Optional `NOTICE` file for attribution and project origin.

This matches the stated goals:

- commercial use is allowed
- source origin and license notices must be preserved
- contributors and users get an explicit patent license
- the `Augustus` name is not automatically licensed for commercial branding

## Why Not The Current Unlicense

The current repository uses the Unlicense. That is too permissive for the stated goal because it places the software in the public domain where possible and does not create a strong attribution-preservation workflow.

If the project should require downstream users to preserve copyright, license, attribution, or NOTICE information, use Apache License 2.0 instead.

## Why Apache License 2.0

Apache License 2.0 is a permissive open source license. It allows commercial use, modification, distribution, and private use, while requiring preservation of license, copyright, patent, trademark, and attribution notices from the source form of the work.

It also states that it does not grant rights to use the licensor's trade names, trademarks, service marks, or product names, except as needed for reasonable descriptive use.

This makes it a better fit than MIT for this project because Apache 2.0 is more explicit about patents and notices.

## Trademark Position

Open source copyright licenses generally do not fully control project branding. To protect the `Augustus` name, keep trademark and naming rules separate from the code license.

Suggested policy:

```text
The source code of Augustus may be used, modified, and distributed under the Apache License 2.0.

The name "Augustus", the Augustus logo, and related project branding are not licensed for use as the name of a commercial product, hosted service, company, package, or distribution without prior written permission.

Forks and derived works may describe themselves as "based on Augustus" or "compatible with Augustus" when that statement is accurate, but they must not imply that they are the official Augustus project or endorsed by the Augustus maintainers.
```

If the name becomes important commercially, consider registering `Augustus` as a trademark in relevant jurisdictions.

## Suggested Files For The Future Public Repo

```text
LICENSE                 Apache License 2.0 text
NOTICE                  project origin and attribution notice
TRADEMARKS.md           Augustus name and logo usage policy
README.md               public project overview
CONTRIBUTING.md         contribution rules and architecture boundaries
SECURITY.md             security reporting process
CODE_OF_CONDUCT.md      community conduct policy
```

## Draft NOTICE

```text
Augustus
Copyright [year] [owner]

Augustus is an open source exploration of agent runtime infrastructure.
This product includes software developed by the Augustus project contributors.
```

## Draft TRADEMARKS.md

```text
# Augustus Trademark Policy

The Augustus name, logo, and related branding identify the official Augustus project.

You may:

- use the Augustus name to truthfully refer to the official project
- say that your project is based on Augustus or compatible with Augustus, when accurate
- retain required copyright, license, attribution, and NOTICE references

You may not, without prior written permission:

- use Augustus as the name of a commercial product, hosted service, company, package, or distribution
- use Augustus branding in a way that implies official endorsement
- use confusingly similar names or logos for a competing commercial offering

The code is licensed separately under the Apache License 2.0.
```

## Migration Note

Before publishing a clean open source repository:

1. Replace the current Unlicense `LICENSE` file with Apache License 2.0.
2. Add a `NOTICE` file.
3. Add `TRADEMARKS.md`.
4. Make sure third-party license notices are preserved.
5. Remove private deployment artifacts, secrets, local data, generated build outputs, and internal-only documents.
