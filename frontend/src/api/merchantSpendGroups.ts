import { api } from "./client"
import type {
  MerchantGroupSeriesResponse,
  MerchantSpendGroupMemberAddResult,
  MerchantSpendGroupMemberRead,
  MerchantSpendGroupRead,
  MerchantSpendGroupSyncApprovalsResponse,
} from "@/types/api"

export async function listMerchantSpendGroups(): Promise<MerchantSpendGroupRead[]> {
  return api.get<MerchantSpendGroupRead[]>("/merchant-spend-groups")
}

export async function createMerchantSpendGroup(displayName: string): Promise<MerchantSpendGroupRead> {
  return api.post<MerchantSpendGroupRead>("/merchant-spend-groups", {
    display_name: displayName,
  })
}

export async function syncSpendGroupApprovals(): Promise<MerchantSpendGroupSyncApprovalsResponse> {
  return api.post<MerchantSpendGroupSyncApprovalsResponse>("/merchant-spend-groups/sync-approvals")
}

export async function deleteMerchantSpendGroup(groupId: number): Promise<void> {
  await api.del(`/merchant-spend-groups/${groupId}`)
}

export async function listGroupMembers(
  groupId: number,
): Promise<MerchantSpendGroupMemberRead[]> {
  return api.get<MerchantSpendGroupMemberRead[]>(`/merchant-spend-groups/${groupId}/members`)
}

export async function addGroupMember(
  groupId: number,
  patternKey: string,
): Promise<MerchantSpendGroupMemberAddResult> {
  return api.post<MerchantSpendGroupMemberAddResult>(
    `/merchant-spend-groups/${groupId}/members`,
    { pattern_key: patternKey },
  )
}

export async function removeGroupMember(groupId: number, memberId: number): Promise<void> {
  await api.del(`/merchant-spend-groups/${groupId}/members/${memberId}`)
}

export type MerchantGroupSeriesScope =
  | { year: number }
  | { trailingCalendarMonths: number }
  | { fromMonth: string; toMonth: string }

export async function getMerchantGroupSeries(
  groupId: number,
  scope: MerchantGroupSeriesScope,
): Promise<MerchantGroupSeriesResponse> {
  const params: Record<string, number | string> = { group_id: groupId }
  if ("year" in scope) {
    params.year = scope.year
  } else if ("trailingCalendarMonths" in scope) {
    params.trailing_calendar_months = scope.trailingCalendarMonths
  } else {
    params.from_month = scope.fromMonth
    params.to_month = scope.toMonth
  }
  return api.get<MerchantGroupSeriesResponse>("/insights/merchant-group-series", params)
}
