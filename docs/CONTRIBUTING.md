# Contributing to Takıştır

## Before your first commit

Set your Git identity to the email on your GitHub account, otherwise your commits will not be counted as yours:

    git config --global user.name "Your Name"
    git config --global user.email "your-github-email@example.com"

## Workflow

1. Pick a Jira issue assigned to you and move it to In Progress.
2. Update `main` and create a branch named after the issue:

       git checkout main
       git pull
       git checkout -b SCRUM-<key>-short-description

3. Make small, meaningful commits. Start every commit message with the Jira key:

       SCRUM-42: add products table migration

4. Run `npm run check` before pushing.
5. Push your branch and open a pull request into `main`. Add the reviewer named in the Jira issue.
6. After approval, merge the pull request and move the Jira issue to Done.

Never push directly to `main`.

## Definition of Done

An issue is done when:

- the code is reviewed and merged through a pull request,
- new behaviour is covered by unit tests,
- `npm run check` passes,
- the acceptance details in the Jira issue are met,
- the Jira issue is moved to Done.

## Reviews

Reviewers read the changes under **Files changed**, try them locally when needed, and choose **Approve**, **Request changes** or **Comment**. Try to review within one day.

## Bugs

Report every bug in Jira using the **Bug** issue type, with steps to reproduce, the expected result and the actual result.
