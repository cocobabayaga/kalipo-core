import { BaseAsset, ApplyAssetContext, ValidateAssetContext } from 'lisk-sdk';
import { db } from '../../../database/db';
import { MembershipValidationError, ProposalResult, ProposalStatus, ProposalType } from '../../../database/enums';
import { RowContext } from '../../../database/row_context';
import { ProposalCampaignComment } from '../../../database/table/proposal_campaign_comment_table';
import { ProposalProvisions } from '../../../database/table/proposal_provisions_table';
import { BinaryVoteResult, MembershipInvitationArguments, MultiChoicePollArguments, MultiChoiceVoteResult, Proposal } from '../../../database/table/proposal_table';

export class MultiChoicePollAsset extends BaseAsset {
	public name = 'MultiChoicePoll';
	public id = 1;

	// Define schema for asset
	public schema = {
		$id: 'proposal/MultiChoicePoll-asset',
		title: 'MultiChoicePollAsset transaction asset for proposal module',
		type: 'object',
		required: ["title", "proposalType", "autonId", "question", "answers"],
		properties: {
			title: {
				dataType: 'string',
				fieldNumber: 1,
				minLength: 2,
				maxLength: 32,
			},
			campaignComment: {
				dataType: 'string',
				fieldNumber: 2,
				maxLength: 1024,
			},
			proposalType: {
				dataType: 'string',
				fieldNumber: 3,
				maxLength: 256,
			},
			autonId: {
				dataType: 'string',
				fieldNumber: 4,
				maxLength: 256,
			},
			question: {
				dataType: 'string',
				fieldNumber: 5,
			},
			answers: {
				type: 'array',
				fieldNumber: 6,
				maxItems: 4,
				items: {
					dataType: 'string'
				}
			}
		},
	};

	public validate({ asset }: ValidateAssetContext<{}>): void {
		// Validate your asset
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	public async apply({ asset, transaction, stateStore }: ApplyAssetContext<{}>): Promise<void> {
		console.log("1")
		const TYPE = ProposalType.MULTI_CHOICE_POLL
		//  Get latest provision for auton by proposal type membership-invtitation
		console.log("2")
		const senderAddress = transaction.senderAddress;

		//Kalipo account
		console.log("3")
		const accountIdWrapper = await db.indices.liskId.getRecord(stateStore, senderAddress.toString('hex'))
		console.log("4")
		const accountId = accountIdWrapper?.id
		console.log("5")
		if (accountId == null) {
			throw new Error("No Kalipo account found for this Lisk account")
		}
		console.log("6")
		const kalipoAccount = await db.tables.kalipoAccount.getRecord(stateStore, accountId)
		console.log("7")
		// Auton
		console.log("8")
		const auton = await db.tables.auton.getRecord(stateStore, asset.autonId)
		if (auton == null) {
			throw new Error("The auton cannot be found")
		}
		console.log("9")
		// Membership
		console.log("10")
		const membershipCheck = await db.tables.membership.validateMembership(kalipoAccount, asset.autonId, stateStore);
		console.log("11")
		const submitterMembershipId: string | null = membershipCheck.membershipId
		console.log("12")
		if (membershipCheck.error == MembershipValidationError.ACCOUNT_NOT_FOUND) {
			throw new Error("No Kalipo account found")
		}
		console.log("13")
		if (membershipCheck.error == MembershipValidationError.NO_ACTIVE_MEMBERSHIP) {
			throw new Error("You need a membership to submit new proposals")
		}
		console.log("14")
		if (membershipCheck.error == MembershipValidationError.OPEN_INVITATION_NOT_ACCEPTED_OR_REFUSED) {
			throw new Error("You aren't member yet, you still need to accept the invitation")
		}
		console.log("15")
		// Provisions
		let provisionId: string | null = null;
		let provision: ProposalProvisions | null = null;
		console.log("AUTON: ")
		console.log(auton)
		console.log(auton.constitution[0].provisions)
		for (let index = 0; index < auton.constitution.length; index++) {
			const proposalType = auton.constitution[index];
			if (proposalType.type == TYPE) {
				console.log("TYPE FOUND")
				if (proposalType.provisions.length > 0) {
					console.log("LENGTH: " + proposalType.provisions.length)
					const lastProvisionId = proposalType.provisions[proposalType.provisions.length - 1]
					const provisionResult = await db.tables.provisions.getRecord(stateStore, lastProvisionId)
					console.log(provisionResult)
					if (provisionResult !== null) {
						provision = provisionResult
						provisionId = lastProvisionId
						break;
					} else {
						throw new Error("Provision not found")
					}

				} else {
					throw new Error("This type has been constitutionalised but is not yet provisioned. Submit a bill to create the first provisions.")
				}
			}
		}

		if (provision == null) {
			throw new Error("This type has not been constitutionalised")
		}

		const created = stateStore.chain.lastBlockHeaders[0].timestamp

		const proposalComments: Array<string> = []
		if (asset.campaignComment != null && asset.campaignComment != "") {
			const proposalCampaignComment: ProposalCampaignComment = {
				proposalId: db.tables.proposal.getDeterministicId(transaction, 0),
				membershipId: submitterMembershipId,
				comment: asset.campaignComment,
				likes: [],
				dislikes: [],
				created: BigInt(created)
			}
			const commentId = await db.tables.campaignComment.createRecord(stateStore,
				transaction, proposalCampaignComment, new RowContext());
			proposalComments.push(commentId)
		}

		const windowOpen = created + Number(provision.campaigning) * 60
		const windowClosed = windowOpen + Number(provision.votingWindow) * 60

		const multiChoicePollArguments: MultiChoicePollArguments = {
			question: asset.question,
			answers: asset.answers
		}

		const multiChoiceVoteResult: MultiChoiceVoteResult = {
			memberCount: 0,
		}

		const membershipInvitationArguments: MembershipInvitationArguments = {
			accountId: "",
			message: ""
		}

		const binaryVoteResult: BinaryVoteResult = {
			result: ProposalResult.UNDECIDED,
			memberCount: 0,
			acceptedCount: 0,
			refusedCount: 0,
			decided: BigInt(0)
		}

		// Creating proposal
		const proposal: Proposal = {
			title: asset.title,
			status: ProposalStatus.CAMPAIGNING,
			actions: [],
			type: ProposalType.MULTI_CHOICE_POLL,
			membershipId: submitterMembershipId,
			provisionId: provisionId,
			autonId: asset.autonId,
			comments: proposalComments,
			votes: [],
			transaction: transaction.id.toString('hex'),
			created: BigInt(created),
			windowOpen: BigInt(windowOpen),
			windowClosed: BigInt(windowClosed),
			binaryVoteResult: binaryVoteResult,
			membershipInvitationArguments: membershipInvitationArguments,
			multiChoiceVoteResult: multiChoiceVoteResult,
			multiChoicePollArguments: multiChoicePollArguments
		}

		console.log("proposal")
		console.log(proposal)
		console.log("20")
		const proposalId = await db.tables.proposal.createRecord(stateStore, transaction, proposal, new RowContext());
		console.log("21")
		// Setting scheduling
		const index = await db.indices.scheduledProposal.getRecord(stateStore, "current");
		if (index !== null) {
			if (index.data === undefined) {
			} else {
			}
			index.data.push({ id: proposalId, scheduled: BigInt(windowOpen) })
			await db.indices.scheduledProposal.setRecord(stateStore, "current", index);


		} else {
			const newIndex = { data: [{ id: proposalId, scheduled: BigInt(windowOpen) }] }
			await db.indices.scheduledProposal.setRecord(stateStore, "current", newIndex);
		}
		console.log("22")
		// Setting reference in auton
		auton.proposals.push(proposalId);
		console.log("23")
		await db.tables.auton.updateRecord(stateStore, asset.autonId, auton)
		console.log("24")
		// Setting reference in membership
		if (membershipCheck.membership != null && membershipCheck.membershipId != null) {
			membershipCheck.membership.proposals.push(proposalId);
			await db.tables.membership.updateRecord(stateStore, membershipCheck.membershipId, membershipCheck.membership)
		}

	}
}
