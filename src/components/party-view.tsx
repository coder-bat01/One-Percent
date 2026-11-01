"use client";

import { useEffect, useRef, useState } from "react";
import {
  Users,
  Plus,
  ArrowRight,
  Settings2,
  Link2,
  Copy,
  Check,
  Crown,
  LogOut,
  UserMinus,
  ShieldCheck,
  Activity,
  X,
} from "lucide-react";
import type { PartyDetail, PartySummary, Profile } from "@/shared/types";
import {
  api,
  dateLabel,
  ErrorMessage,
  Form,
  Loading,
  Modal,
  ProgressBar,
  quantity,
  Submit,
  TaskReadOnly,
  useAction,
  useResource,
} from "./ui";
import { ProgressView } from "./progress-view";

type PartyProps = {
  parties: PartySummary[];
  user: Profile;
  selected: string;
  memberId: string;
  version: number;
  today: string;
  offline: boolean;
  refresh: () => void;
  navigate: (params: Record<string, string>) => void;
};
export function PartyView({
  parties,
  user,
  selected,
  memberId,
  version,
  today,
  offline,
  refresh,
  navigate,
}: PartyProps) {
  const [create, setCreate] = useState(false);
  const [join, setJoin] = useState(false);
  const [settings, setSettings] = useState(false);
  const [joinValue, setJoinValue] = useState("");
  const [joinError, setJoinError] = useState("");
  const resource = useResource<PartyDetail>(
    selected ? `/api/parties/${encodeURIComponent(selected)}` : null,
    version,
  );
  const party = resource.data;
  const member = party?.members.find((person) => person.id === memberId);
  const [memberRange, setMemberRange] = useState<"week" | "month">("week");
  const [memberAnchor, setMemberAnchor] = useState(today);
  useEffect(() => {
    if (member) setMemberAnchor(member.date);
  }, [memberId, member?.date]);
  return (
    <section>
      <header className="page-heading">
        <div>
          <span className="eyebrow">BETTER, TOGETHER</span>
          <h1>Your people. Your pace.</h1>
          <p className="muted">A private space to show up for each other.</p>
        </div>
        <button
          className="button primary"
          onClick={() => setCreate(true)}
          disabled={offline}
        >
          <Plus size={18} />
          Create party
        </button>
      </header>
      <div className="party-toolbar">
        <div className="party-tabs" aria-label="Choose a party">
          {parties.map((item) => (
            <button
              key={item.id}
              aria-pressed={selected === item.id}
              onClick={() => navigate({ party: item.id, member: "" })}
            >
              <Users size={16} />
              {item.name}
            </button>
          ))}
        </div>
        <button className="button secondary" onClick={() => setJoin(true)}>
          <Link2 size={17} />
          Join with invite
        </button>
      </div>
      {!selected && (
        <div className="empty-state party-empty">
          <div className="empty-orbit">
            <Users size={35} />
          </div>
          <span className="eyebrow">
            A LITTLE ACCOUNTABILITY GOES A LONG WAY
          </span>
          <h2>Find your circle.</h2>
          <p>
            Create a private party and invite the people you want beside you.
            Only tasks you choose to share are visible.
          </p>
          <div className="button-row">
            <button
              className="button primary"
              onClick={() => setCreate(true)}
              disabled={offline}
            >
              <Plus size={18} />
              Create a party
            </button>
            <button className="button secondary" onClick={() => setJoin(true)}>
              I have an invite <ArrowRight size={17} />
            </button>
          </div>
          <div className="privacy-note">
            <ShieldCheck size={16} />
            Private by default. No rankings. Just progress.
          </div>
        </div>
      )}
      <ErrorMessage error={resource.error} />
      {resource.loading && !party && <Loading text="Opening your party…" />}
      {party && (
        <>
          <div className="party-banner">
            <div className="party-emblem">
              <Users size={28} />
            </div>
            <div className="party-intro">
              <h2>{party.name}</h2>
              <p>{party.description || "A little better, together."}</p>
              <span className="small muted">
                {party.memberCount}{" "}
                {party.memberCount === 1 ? "member" : "members"} · Private party
              </span>
            </div>
            <div className="party-average">
              <strong>
                {party.percent === null ? "—" : `${Math.round(party.percent)}%`}
              </strong>
              <span>shared daily progress</span>
            </div>
            <button
              className="icon-button"
              onClick={() => setSettings(true)}
              aria-label="Party settings"
            >
              <Settings2 size={20} />
            </button>
          </div>
          <div className="section-heading">
            <h2>Everyone’s showing up</h2>
            <span className="badge">
              <ShieldCheck size={12} />
              Private circle
            </span>
          </div>
          <div className="members-grid">
            {party.members.map((person) => (
              <button
                className="member-card"
                key={person.id}
                onClick={() => {
                  setMemberAnchor(person.date);
                  navigate({ member: person.id });
                }}
              >
                <div className="member-top">
                  <span className="avatar">
                    {person.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <strong>
                      {person.name}
                      {person.id === user.id && (
                        <span className="muted"> (you)</span>
                      )}
                    </strong>
                    <small>
                      {person.id === party.ownerId
                        ? "Party owner"
                        : "Party member"}
                    </small>
                  </span>
                  {person.id === party.ownerId && (
                    <Crown size={17} className="lime" />
                  )}
                </div>
                <div className="member-number">
                  {person.percent === null ? (
                    <span className="no-plan">No shared tasks planned</span>
                  ) : (
                    <>
                      <strong>
                        {Math.round(person.percent)}
                        <span>%</span>
                      </strong>
                      <span>
                        {person.completed} of {person.total} tasks complete
                      </span>
                    </>
                  )}
                </div>
                <ProgressBar
                  value={person.percent}
                  label={`${person.name} shared progress`}
                />
                <div className="member-footer">
                  <span>
                    {person.date !== today || person.timezone !== user.timezone
                      ? `${dateLabel(person.date)} · ${person.timezone.replaceAll("_", " ")}`
                      : "Today’s shared plan"}
                  </span>
                  <ArrowRight size={16} />
                </div>
              </button>
            ))}
          </div>
          <section className="activity-section">
            <div className="section-heading">
              <h2>
                <Activity size={18} /> In the loop
              </h2>
              <span className="muted small">Recent shared activity</span>
            </div>
            {party.activity.length ? (
              <div className="activity-list">
                {party.activity.map((item) => (
                  <div key={item.id}>
                    <span className="avatar small-avatar">
                      {item.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <p>
                        <strong>{item.name}</strong>{" "}
                        {item.type === "binary"
                          ? item.value >= 1
                            ? "completed"
                            : "updated"
                          : "logged"}{" "}
                        {item.type !== "binary" && (
                          <strong>
                            {quantity(item.value, item.type, item.unit)}
                          </strong>
                        )}{" "}
                        <span className="muted">·</span> {item.title}
                      </p>
                      <time dateTime={item.updatedAt}>
                        {new Date(item.updatedAt).toLocaleString()}
                      </time>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="quiet-empty">
                <Activity size={22} />
                <p>It’s quiet here, for now.</p>
                <span>
                  Your party’s shared progress updates will appear here.
                </span>
              </div>
            )}
          </section>
        </>
      )}
      {create && (
        <CreateParty
          offline={offline}
          close={() => setCreate(false)}
          refresh={refresh}
          select={(id) => navigate({ party: id })}
        />
      )}
      {join && (
        <Modal title="Join your people" close={() => setJoin(false)}>
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const value = joinValue.trim();
                const token = value.includes("?")
                  ? new URL(value, window.location.origin).searchParams.get(
                      "invite",
                    )
                  : value;
                if (!token)
                  throw new Error("Paste a complete invitation link or token.");
                setJoin(false);
                navigate({ invite: token });
              } catch (error) {
                setJoinError(
                  error instanceof Error
                    ? error.message
                    : "This invite link is not valid.",
                );
              }
            }}
          >
            <p className="muted">
              Paste the private invitation link your friend sent you. You’ll see
              the party before you join.
            </p>
            <ErrorMessage error={joinError} />
            <label>
              Invitation link or token
              <input
                data-autofocus
                value={joinValue}
                onChange={(event) => setJoinValue(event.target.value)}
                required
                placeholder="https://…/?invite=…"
              />
            </label>
            <footer className="form-footer">
              <button
                className="button secondary"
                type="button"
                onClick={() => setJoin(false)}
              >
                Cancel
              </button>
              <button className="button primary" type="submit">
                Preview party <ArrowRight size={17} />
              </button>
            </footer>
          </Form>
        </Modal>
      )}
      {settings && party && (
        <PartySettings
          party={party}
          user={user}
          offline={offline}
          close={() => setSettings(false)}
          refresh={refresh}
          leave={() => {
            setSettings(false);
            navigate({ party: "", member: "" });
          }}
        />
      )}
      {memberId && party && !member && (
        <div className="notice" role="status">
          This member is no longer in the party.
          <button
            className="text-button"
            onClick={() => navigate({ member: "" })}
          >
            Dismiss
          </button>
        </div>
      )}
      {member && party && (
        <Modal
          title={`${member.name}’s shared plan`}
          wide
          close={() => navigate({ member: "" })}
        >
          <div className="member-detail">
            <div className="member-detail-heading">
              <span className="avatar">
                {member.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong>{dateLabel(member.date, true)}</strong>
                <p className="muted small">
                  {member.timezone.replaceAll("_", " ")} · Only tasks shared
                  with this party
                </p>
              </div>
            </div>
            {member.tasks.length ? (
              member.tasks.map((task) => (
                <TaskReadOnly key={task.id} task={task} />
              ))
            ) : (
              <p className="quiet-empty">
                No shared tasks planned for this day.
              </p>
            )}
            <h3 className="history-heading">Shared history</h3>
            <ProgressView
              endpoint={`/api/parties/${party.id}/members/${member.id}/history`}
              version={version}
              initialDate={member.date}
              range={memberRange}
              anchor={memberAnchor}
              member
              navigate={(params) => {
                if (params.range)
                  setMemberRange(params.range as "week" | "month");
                if (params.anchor) setMemberAnchor(params.anchor);
              }}
            />
          </div>
        </Modal>
      )}
    </section>
  );
}

function CreateParty({
  offline,
  close,
  refresh,
  select,
}: {
  offline: boolean;
  close: () => void;
  refresh: () => void;
  select: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const action = useAction(refresh);
  return (
    <Modal title="Start your party" close={close}>
      <Form
        pending={action.pending}
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(
            () =>
              api<{ party: PartySummary }>("/api/parties", {
                name,
                description,
              }),
            (data) => {
              select(data.party.id);
              close();
            },
          );
        }}
      >
        <p className="muted">Make a little room for mutual encouragement.</p>
        <ErrorMessage error={action.error} />
        <label>
          Party name
          <input
            data-autofocus
            value={name}
            required
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Give your circle a name"
          />
        </label>
        <label>
          Description <span className="optional">optional</span>
          <textarea
            value={description}
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What are you working toward together?"
            rows={3}
          />
        </label>
        <footer className="form-footer">
          <button className="button secondary" type="button" onClick={close}>
            Cancel
          </button>
          <Submit pending={action.pending} offline={offline}>
            Create party
          </Submit>
        </footer>
      </Form>
    </Modal>
  );
}

function PartySettings({
  party,
  user,
  offline,
  close,
  refresh,
  leave,
}: {
  party: PartyDetail;
  user: Profile;
  offline: boolean;
  close: () => void;
  refresh: () => void;
  leave: () => void;
}) {
  const [name, setName] = useState(party.name);
  const [description, setDescription] = useState(party.description);
  const [invite, setInvite] = useState<{
    id: string;
    token: string;
    expiresAt: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [confirm, setConfirm] = useState<{
    action: "leave" | "remove" | "transfer";
    memberId?: string;
    name?: string;
  } | null>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirm) {
      confirmation.current?.focus();
      confirmation.current?.scrollIntoView({ block: "nearest" });
    }
  }, [confirm]);
  const action = useAction(refresh);
  const owner = party.ownerId === user.id;
  const url = invite
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/?invite=${invite.token}`
    : "";
  return (
    <Modal title="Party settings" close={close}>
      <div className="settings-body">
        <ErrorMessage error={action.error} />
        {owner ? (
          <Form
            pending={action.pending}
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(() =>
                api(`/api/parties/${party.id}/settings`, { name, description }),
              );
            }}
          >
            <h3>Your party</h3>
            <label>
              Party name
              <input
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                rows={2}
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <Submit pending={action.pending} offline={offline}>
              Save party details
            </Submit>
          </Form>
        ) : (
          <p className="muted">
            Only the owner can change party settings. Your own tasks are always
            yours to manage.
          </p>
        )}
        {owner && (
          <section className="settings-section">
            <div className="section-heading">
              <h3>Invite your people</h3>
              <button
                className="button secondary"
                disabled={action.pending || offline}
                onClick={() => {
                  void action.run(
                    () =>
                      api<{ id: string; token: string; expiresAt: string }>(
                        `/api/parties/${party.id}/invites`,
                        {},
                      ),
                    (result) => {
                      setInvite(result);
                      setCopied(false);
                      setCopyError("");
                    },
                  );
                }}
              >
                <Plus size={16} />
                New invite
              </button>
            </div>
            <p className="muted small">
              Links expire after 7 days. Copy a new link now; it cannot be
              recovered later.
            </p>
            {invite && (
              <div className="invite-result">
                <label>
                  Your invitation link
                  <input
                    readOnly
                    value={url}
                    onFocus={(event) => event.target.select()}
                  />
                </label>
                <button
                  className="button primary"
                  type="button"
                  onClick={() => {
                    if (!navigator.clipboard?.writeText) {
                      setCopyError(
                        "Copy isn’t available here. Select the link above and copy it manually.",
                      );
                      return;
                    }
                    void navigator.clipboard
                      .writeText(url)
                      .then(() => {
                        setCopied(true);
                        setCopyError("");
                      })
                      .catch(() =>
                        setCopyError(
                          "Copy isn’t available here. Select the link above and copy it manually.",
                        ),
                      );
                  }}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <ErrorMessage error={copyError} />
              </div>
            )}
            {party.invites.length ? (
              <div className="invite-list">
                {party.invites.map((item) => (
                  <div key={item.id}>
                    <Link2 size={16} />
                    <span>
                      {item.revoked
                        ? "Revoked"
                        : new Date(item.expiresAt) < new Date()
                          ? "Expired"
                          : "Active invitation"}
                      <small>
                        Expires {new Date(item.expiresAt).toLocaleDateString()}
                      </small>
                    </span>
                    {!item.revoked && (
                      <button
                        className="button subtle"
                        disabled={action.pending || offline}
                        onClick={() => {
                          void action.run(
                            () =>
                              api(
                                `/api/parties/${party.id}/invites/${item.id}/revoke`,
                                {},
                              ),
                            () => {
                              if (invite?.id === item.id) setInvite(null);
                            },
                          );
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="field-note">No invitations created yet.</p>
            )}
          </section>
        )}
        <section className="settings-section">
          <h3>Membership</h3>
          <div className="membership-list">
            {party.members.map((person) => (
              <div key={person.id}>
                <span className="avatar small-avatar">
                  {person.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="membership-name">
                  {person.name}
                  <small>
                    {person.id === party.ownerId ? "Owner" : "Member"}
                  </small>
                </span>
                {owner && person.id !== user.id && (
                  <div className="membership-actions">
                    <button
                      className="icon-button"
                      aria-label={`Make ${person.name} party owner`}
                      title="Transfer ownership"
                      disabled={offline || action.pending}
                      onClick={() =>
                        setConfirm({
                          action: "transfer",
                          memberId: person.id,
                          name: person.name,
                        })
                      }
                    >
                      <Crown size={17} />
                    </button>
                    <button
                      className="icon-button danger-text"
                      aria-label={`Remove ${person.name}`}
                      disabled={offline || action.pending}
                      onClick={() =>
                        setConfirm({
                          action: "remove",
                          memberId: person.id,
                          name: person.name,
                        })
                      }
                    >
                      <UserMinus size={17} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="settings-section">
          <h3>Leave this party</h3>
          <p className="muted small">
            Your personal tasks and history stay with you. You’ll no longer see
            this party’s shared data.
            {owner &&
              party.memberCount > 1 &&
              " Transfer ownership to another member before leaving."}
            {owner &&
              party.memberCount === 1 &&
              " As the last member, leaving will delete the party."}
          </p>
          <button
            className="button danger-text"
            disabled={
              offline || action.pending || (owner && party.memberCount > 1)
            }
            onClick={() => setConfirm({ action: "leave" })}
          >
            <LogOut size={17} />
            Leave party
          </button>
        </section>
        {confirm && (
          <div
            className="confirm-box"
            role="alert"
            tabIndex={-1}
            ref={confirmation}
          >
            <div className="section-heading">
              <strong>
                {confirm.action === "leave"
                  ? "Leave this party?"
                  : confirm.action === "remove"
                    ? `Remove ${confirm.name}?`
                    : `Make ${confirm.name} the owner?`}
              </strong>
              <button
                className="icon-button"
                aria-label="Cancel action"
                onClick={() => setConfirm(null)}
              >
                <X size={17} />
              </button>
            </div>
            <p>
              {confirm.action === "transfer"
                ? "You’ll become a regular member. Only the new owner can manage membership and invitations."
                : "Party access will be revoked immediately. Personal history is kept."}
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="button danger"
                disabled={offline || action.pending}
                onClick={() => {
                  void action.run(
                    () =>
                      api(`/api/parties/${party.id}/members`, {
                        action: confirm.action,
                        ...(confirm.memberId
                          ? { memberId: confirm.memberId }
                          : {}),
                      }),
                    () => {
                      if (confirm.action === "leave") leave();
                      setConfirm(null);
                    },
                  );
                }}
              >
                Confirm {confirm.action}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
