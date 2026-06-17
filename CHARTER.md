# cosmos.gl Charter

<a name="section-0-guiding-principles-optional"></a>

## Section 0: Guiding Principles

**Mission:** Provide the web development community with a high-performance framework for visualizing network graphs and scatter plots.

**Vision:** Deliver fast, robust, open-source data visualization tools that empower interactive, scalable analysis in the browser.

**Values:**

- **Performance First:** Prioritize speed and efficiency in every feature and implementation.
- **Accessibility:** Ensure the API is intuitive and the tooling easy to adopt, lowering barriers for developers.
- **Community:** Foster open collaboration, welcoming contributions and feedback.
- **Transparency:** Maintain clear documentation, benchmarks, and decision-making processes.

<a name="section-1"></a>
<a name="section-1-scope"></a>
<a name="11-in-scope-optional"></a>
<a name="12-out-of-scope-optional"></a>

## Section 1: Mission and Scope of the Project

cosmos.gl is a browser-native, GPU-accelerated force-directed graph layout and rendering engine designed to visualize and interact with massive, complex datasets at scale. By leveraging WebGL, it delivers fast simulations and real-time rendering of millions of nodes and edges directly in the browser. cosmos.gl bridges the gap between high-performance data visualization and interactive web-based research workflows, serving developers, researchers, and analysts. Its value lies in unlocking scalable, explainable graph exploration for AI, biotech, finance, and data science stakeholders.

### Section 1.1: In-scope

- GPU-accelerated graph algorithms
- WebGL- and WebGPU-based rendering of large-scale network graphs and machine learning embeddings
- Browser-native integration with frontend tooling and workflows

### Section 1.2: Out-of-Scope

- Server-side computation, backend data processing, and pipelines
- Native desktop or mobile applications outside the browser environment
- Direct integration with domain-specific tools

<a name="section-2"></a>
<a name="21-other-formal-project-relationships-optional"></a>

## Section 2: Relationship with OpenJS Foundation CPC

The OpenJS Cross Project Council (CPC) delegates technical leadership of this project to the governing body defined in [Section 3 of this charter](#section-3).

This project is entitled to representation in the CPC through voting members as described in [Section 4](https://github.com/openjs-foundation/cross-project-council/blob/main/CPC-CHARTER.md#voting-members) of the CPC Charter.

<a name="section-3"></a>
<a name="section-3-project-tsc-governing-body"></a>
<a name="section-43-other-project-roles-optional"></a>

## Section 3: Governing Body of the Project

This project is governed by the cosmos.gl Technical Steering Committee (TSC).

Governing body membership and governance of this project are defined in [GOVERNANCE.md](./GOVERNANCE.md).

TSC members may attend meetings, participate in discussions, and vote on all matters before the TSC. TSC memberships are not time-limited, and there is no maximum size of the TSC.

There is no specific set of requirements or qualifications for TSC membership beyond these rules. A TSC member can be removed from the TSC by voluntary resignation or by a standard TSC motion.

The TSC shall meet regularly using tools that enable participation by the community. The meeting shall be directed by the TSC chairperson. Responsibility for directing individual meetings may be delegated by the TSC chairperson to any other TSC member. Minutes or an appropriate recording shall be taken and made available to the community through accessible public postings.

TSC members are expected to regularly participate in TSC activities.

The TSC chairperson is elected by a simple majority vote of all TSC members. The chairperson serves until they resign or are replaced by a TSC vote. Any TSC member may call for a vote at any time, provided the proposal is made in writing and shared with the full TSC. Votes may be held in meetings or asynchronously using any communication tool commonly used by the TSC.

<a name="section-4"></a>
<a name="section-4-roles--responsibilities"></a>
<a name="section-41-project-operations--management-optional"></a>

## Section 4: Responsibilities of the Governing Body of the Project

The roles, responsibilities, operations, and management processes of cosmos.gl's TSC are described in [GOVERNANCE.md](./GOVERNANCE.md).

<a name="section-42-decision-making-voting-andor-elections"></a>

<a name="section-5"></a>
## Section 5: Decision-making

Project decisions shall operate under a model of Lazy Consensus by default. The TSC shall define appropriate guidelines for implementing Lazy Consensus, such as notification periods and review windows, within the development process.

When consensus cannot be reached, the TSC shall decide via public voting.

<a name="section-6"></a>
## Section 6: Voting

Each vote presents the available options in a format that supports clear expression of member preferences, such as polls, emoji reactions, checklists, or comparable methods. TSC members may vote for one or more options or abstain. Unless otherwise specified, the winning option is the one that receives the greatest support among participating members.

For decisions involving three or more options, the TSC may optionally conduct pairwise comparisons between all candidates. In such cases, the winner is the candidate who secures a simple majority against every other candidate in head-to-head matchups. All votes are public, and voting activity may be adjusted until the close of the voting period.

<a name="section-5-definitions-optional"></a>

## Definitions

### Agenda Item

An agenda item is a specific topic, proposal, or issue scheduled for discussion or decision during a TSC meeting. Examples include proposed technical changes, governance matters, or any subject requiring TSC review or input. Agenda items are published in advance to allow TSC members and the community to prepare for discussion or decision-making.

<a name="section-6-changes-to-this-document"></a>
<a name="section-7"></a>

## Section 7: Changes to this Document

Changes to this document require approval from both [the CPC][charter-approval] and the TSC.

[charter-approval]: https://github.com/openjs-foundation/cross-project-council/blob/main/governance/GOVERNANCE.md#approving-project-charters
