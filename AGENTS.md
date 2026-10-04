# Product Context

We are building an AI Apprentice for a hackathon.

The product is designed to learn how an expert performs a task and then teach that same task to an employee or customer.

The main use case is software workflows, operational processes, laboratory procedures, or other tasks where an experienced person has knowledge that may not be fully documented.

The product has two main modes:

## Learn Mode

An expert joins a Google Meet with the AI agent and shares their screen.

The AI watches what the expert is doing, listens to their explanation, and follows the workflow in real time.

The AI should try to understand not only **what** the expert does, but also **why** they do it.

When the expert makes a non-obvious decision, the agent can naturally ask a question.

Example:

The expert is processing a $100 order but enters a refund of only $70.

The AI may ask:

> Why are you refunding $70 instead of the full $100?

The expert might explain:

> Because the order has already been fulfilled, so shipping is not refundable.

The AI should capture this as useful knowledge.

Over the course of the session, the system learns:

- steps in the workflow
- decisions
- conditions
- rules
- exceptions
- warnings
- expert judgment
- important context

This information becomes a structured representation of the workflow called a **Work Map**.

The goal is not simply to record a tutorial.

The goal is to capture the hidden knowledge behind how an experienced person actually works.

---

## Teach Mode

Later, an employee or customer can join another Google Meet with the AI agent and share their screen.

The AI loads the Work Map that was previously learned from the expert.

The agent can then guide the person through the workflow in real time.

For example:

> Open the customer's order.

The AI watches the employee do it.

Then:

> Check whether the order has already been fulfilled.

The employee can also ask questions naturally:

> Why does fulfillment matter?

The AI should answer using the knowledge previously learned from the expert.

The system should also recognize when the employee is making a mistake.

For example, if the employee enters a $100 refund when the learned rule says fulfilled orders should exclude $30 shipping, the AI can intervene:

> Before you submit that, this order has already been fulfilled, so shipping should not be included. Change the refund amount to $70.

---

# Core Product Loop

The fundamental product flow is:

```text
Expert
  ↓
AI observes the expert working
  ↓
AI listens to their explanation
  ↓
AI asks useful "why" questions
  ↓
AI learns rules, steps, and exceptions
  ↓
Work Map
  ↓
Employee or customer
  ↓
AI observes them performing the workflow
  ↓
AI explains what to do next
  ↓
AI answers questions
  ↓
AI detects mistakes and provides guidance
```

---

# Google Meet Experience

Google Meet is the primary interaction interface.

The AI should appear as a participant in the meeting.

The user should be able to invite the AI to a Google Meet, share their screen, and interact with it through normal voice conversation.

The AI needs access to:

- the user's voice
- the shared screen
- the current meeting context

The AI can speak back into the meeting.

The desired experience should feel like having an experienced coworker sitting in the call and watching what the user is doing.

---

# Product Philosophy

The important distinction is:

A screen recording shows **what happened**.

Documentation explains **what should happen**.

Our AI Apprentice tries to understand **why the expert made each important decision**.

The product should therefore focus on capturing knowledge that is usually difficult to document, such as:

- judgment
- exceptions
- edge cases
- thresholds
- hidden rules
- practical experience
- warnings
- context-dependent decisions

The product should avoid interrupting users unnecessarily.

The AI should ask questions only when doing so helps uncover useful knowledge.

---

# Example Demo

The ideal demo contains two sessions.

### Session 1 — Expert

An expert demonstrates how to process a refund.

The expert enters $70 for a $100 order.

The AI notices the difference and asks:

> Why are you refunding $70 instead of $100?

The expert explains:

> Because this order is already fulfilled and shipping is not refundable.

The system learns this rule.

### Session 2 — Employee

An employee later performs the same workflow.

They attempt to refund the full $100.

The AI remembers what the expert taught it and says:

> Before you submit that, this order has already been fulfilled. Shipping should not be included in the refund, so the amount should be $70.

This demonstrates that the AI did not merely record the expert.

It learned from the expert and then applied that knowledge while teaching someone else.

---

# Product Goal

The final product should feel like an AI coworker that can:

**watch an expert once, understand how they work, and then teach that knowledge to everyone else.**