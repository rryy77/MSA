import type { Slot } from "./slots";

export type SessionStatus =
  | "awaiting_organizer_round1"
  | "awaiting_participant_availability"
  | "awaiting_participant"
  | "awaiting_organizer_final"
  | "awaiting_organizer_confirm"
  | "participant_declined"
  | "completed";

export type Session = {
  id: string;
  /** 作成したログインユーザー（Supabase auth.users の id） */
  organizerUserId?: string;
  triggerAt: string;
  triggerDateJst: string;
  candidateDates?: string[];
  status: SessionStatus;
  slots: Slot[];
  organizerRound1Ids: string[];
  participantIds: string[];
  organizerFinalIds: string[];
  participantToken: string;
  /** 案内を送った参加者ユーザー（アプリ登録者） */
  participantUserId?: string;
  /** 旧データ用（現在は未使用） */
  participantEmail?: string;
  /** 参加者が「行ける」とチェックした枠（主催者の確定前） */
  participantPreferredSlotIds?: string[];
  /** 主催者が確定時に「都合が付く」とチェックした枠（積集合計算前） */
  organizerPreferredSlotIds?: string[];
  calendarCreated: boolean;
  createdEventIds: string[];
  /** Google カレンダー作成時の Meet リンク（createdEventIds と同じ順） */
  calendarMeetLinks?: string[];
  finalizedAt?: string;
  /** 日程案内を送信した日時 */
  emailSentAt?: string;
  /** 参加用リンクを実際にメール送信したとき */
  inviteEmailSentAt?: string;
  /** 日程候補を相手に送った日時（アプリ内通知含む） */
  scheduleInviteSentAt?: string;
  /** B が「候補が合わない」と回答した日時 */
  participantDeclinedAt?: string;
};
