import React, { useCallback, useEffect, useState } from 'react';
import { BlockModel, useAPIClient } from '@nocobase/client';
import { observer, tExpr } from '@nocobase/flow-engine';
import { Alert, Button, Form, Input, Modal, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { CopyOutlined, PlayCircleOutlined, SaveOutlined, WarningOutlined } from '@ant-design/icons';

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

const copyToClipboard = (text: string) => {
  navigator.clipboard
    .writeText(text)
    .then(() => message.success('Copied to clipboard'))
    .catch((err) => message.error('Failed to copy: ' + err));
};

/**
 * SQL editor + run UI for users WITH sql config permission (admin mode).
 * Supports free-form SQL with destructive-query confirmation.
 */
const AdminSQLConsole: React.FC<{ blockUid: string }> = ({ blockUid }) => {
  const api = useAPIClient();
  const [sql, setSql] = useState('');
  const [bindValues, setBindValues] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [affectedCount, setAffectedCount] = useState<number | null>(null);
  const [pendingSql, setPendingSql] = useState<string | null>(null);

  // Extract variables starting with $ (e.g., $status, $minAge) from the free-form SQL
  const bindKeys = Array.from(new Set(Array.from(sql.matchAll(/\$([a-zA-Z0-9_]+)/g)).map((m) => m[1])));

  const getCountQuery = (sqlText: string): string | null => {
    const trimmed = sqlText.trim().replace(/\s+/g, ' ');
    const updateMatch = trimmed.match(/^UPDATE\s+([a-zA-Z0-9_"]+)\s+SET\s+(?:.*?)(\s+WHERE\s+.*)?$/i);
    if (updateMatch) {
      return `SELECT count(*) as count FROM ${updateMatch[1]}${updateMatch[2] || ''}`;
    }
    const deleteMatch = trimmed.match(/^DELETE\s+FROM\s+([a-zA-Z0-9_"]+)(\s+WHERE\s+.*)?$/i);
    if (deleteMatch) {
      return `SELECT count(*) as count FROM ${deleteMatch[1]}${deleteMatch[2] || ''}`;
    }
    return null;
  };

  const applyResults = (data: unknown) => {
    if (Array.isArray(data) && data.length > 0) {
      setColumns(
        Object.keys(data[0] as Record<string, unknown>).map((key) => ({
          title: key,
          dataIndex: key,
          key,
          render: (val: any) => (typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')),
        })),
      );
      setResults(data as Record<string, unknown>[]);
    } else {
      setColumns([]);
      setResults([]);
      message.success('Execution completed, no rows returned.');
    }
  };

  const executeSql = useCallback(
    async (sqlToExecute: string) => {
      setLoading(true);
      try {
        const res = await api.request({
          url: 'flowSql:run',
          method: 'POST',
          data: { sql: sqlToExecute, type: 'selectRows', bind: bindValues },
        });
        applyResults(res.data?.data);
      } catch (error: unknown) {
        const msg = (error as { response?: { data?: { error?: { message?: string } } }; message?: string })?.response
          ?.data?.error?.message;
        message.error(msg || (error as Error).message || 'Execution failed');
      } finally {
        setLoading(false);
      }
    },
    [api, bindValues],
  );

  const handleRun = async () => {
    if (!sql.trim()) {
      message.warning('Please enter a SQL query');
      return;
    }
    const isModify = /^(UPDATE|DELETE)\b/i.test(sql.trim());
    if (isModify) {
      const countQuery = getCountQuery(sql);
      if (countQuery) {
        setLoading(true);
        try {
          const res = await api.request({
            url: 'flowSql:run',
            method: 'POST',
            data: { sql: countQuery, type: 'selectVar', bind: bindValues },
          });
          setAffectedCount(Number(res.data?.data) ?? 0);
        } catch {
          setAffectedCount(null);
        } finally {
          setLoading(false);
        }
      } else {
        setAffectedCount(null);
      }
      setPendingSql(sql);
      setConfirmVisible(true);
    } else {
      executeSql(sql);
    }
  };

  const handleConfirmRun = () => {
    setConfirmVisible(false);
    if (pendingSql) {
      executeSql(pendingSql);
      setPendingSql(null);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%', display: 'flex' }}>
      <Input.TextArea
        style={{ fontFamily: 'monospace', minHeight: 180 }}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        placeholder="Enter SQL query... e.g. SELECT * FROM users WHERE status = $status LIMIT 10"
      />
      {bindKeys.length > 0 && (
        <Form layout="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
          {bindKeys.map((key) => (
            <Form.Item key={key} label={<Tag color="blue">${key}</Tag>} style={{ marginBottom: 8 }}>
              <Input
                placeholder={`Value for $${key}`}
                value={bindValues[key] || ''}
                onChange={(e) => setBindValues((prev) => ({ ...prev, [key]: e.target.value }))}
                style={{ width: 160 }}
              />
            </Form.Item>
          ))}
        </Form>
      )}
      <Space>
        <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleRun} loading={loading}>
          Run SQL
        </Button>
        {results.length > 0 && (
          <Button icon={<CopyOutlined />} onClick={() => copyToClipboard(JSON.stringify(results, null, 2))}>
            Copy JSON
          </Button>
        )}
      </Space>
      {columns.length > 0 && (
        <Table
          columns={columns}
          dataSource={results.map((row, i) => ({ ...row, key: i }))}
          pagination={false}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      )}
      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: '#faad14' }} />
            Confirm Execution
          </Space>
        }
        open={confirmVisible}
        onOk={handleConfirmRun}
        onCancel={() => setConfirmVisible(false)}
        okText="Execute"
        okButtonProps={{ danger: true }}
      >
        <Typography.Text>You are about to execute a data modification query (UPDATE/DELETE).</Typography.Text>
        <div style={{ marginTop: 12 }}>
          {affectedCount !== null ? (
            <Typography.Text type="danger" strong>
              This query will affect {affectedCount} row(s).
            </Typography.Text>
          ) : (
            <Typography.Text type="warning">
              Unable to preview affected rows count. Proceed with caution.
            </Typography.Text>
          )}
        </div>
      </Modal>
    </Space>
  );
};

/**
 * SQL runner for users WITHOUT sql config permission (template mode).
 * Loads `$name` params from the saved template via `flowSql:getBind`,
 * then executes via `flowSql:runById` with the user-supplied bind values.
 */
const TemplateSQLConsole: React.FC<{ blockUid: string; templateSql: string }> = ({ blockUid, templateSql }) => {
  const api = useAPIClient();
  const bindKeys = Array.from(new Set(Array.from(templateSql.matchAll(/\$([a-zA-Z0-9_]+)/g)).map((m) => m[1])));
  const [bindValues, setBindValues] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Initialize bindValues once when bindKeys change
  useEffect(() => {
    setBindValues((prev) => {
      const next = { ...prev };
      bindKeys.forEach((k) => {
        if (next[k] === undefined) next[k] = '';
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateSql, JSON.stringify(bindKeys)]);

  const handleRun = async () => {
    setLoading(true);
    try {
      const res = await api.request({
        url: 'flowSql:runById',
        method: 'POST',
        data: { uid: blockUid, bind: bindValues, type: 'selectRows' },
      });
      const data = res.data?.data;
      if (Array.isArray(data) && data.length > 0) {
        setColumns(
          Object.keys(data[0] as Record<string, unknown>).map((key) => ({
            title: key,
            dataIndex: key,
            key,
            render: (val: any) => (typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')),
          })),
        );
        setResults(data as Record<string, unknown>[]);
      } else {
        setColumns([]);
        setResults([]);
        message.success('Execution completed, no rows returned.');
      }
    } catch (error: unknown) {
      const msg = (error as { response?: { data?: { error?: { message?: string } } }; message?: string })?.response
        ?.data?.error?.message;
      message.error(msg || (error as Error).message || 'Execution failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%', display: 'flex' }}>
      <Typography.Title level={5}>SQL Template</Typography.Title>
      <pre style={{ padding: 12, background: '#f5f5f5', borderRadius: 4, margin: 0, fontFamily: 'monospace' }}>
        {templateSql}
      </pre>

      {bindKeys.length > 0 && (
        <Form layout="inline" style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {bindKeys.map((key) => (
            <Form.Item key={key} label={<Tag color="blue">${key}</Tag>} style={{ marginBottom: 8 }}>
              <Input
                placeholder={`Value for $${key}`}
                value={bindValues[key]}
                onChange={(e) => setBindValues((prev) => ({ ...prev, [key]: e.target.value }))}
                style={{ width: 160 }}
              />
            </Form.Item>
          ))}
        </Form>
      )}
      <Space>
        <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleRun} loading={loading}>
          Run SQL
        </Button>
        {results.length > 0 && (
          <Button icon={<CopyOutlined />} onClick={() => copyToClipboard(JSON.stringify(results, null, 2))}>
            Copy JSON
          </Button>
        )}
      </Space>
      {columns.length > 0 && (
        <Table
          columns={columns}
          dataSource={results.map((row, i) => ({ ...row, key: i }))}
          pagination={false}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      )}
    </Space>
  );
};

// ─────────────────────────────────────────────
// Main block component
// ─────────────────────────────────────────────

interface SQLConsoleProps {
  blockUid: string;
  allowNormalUser: boolean;
  templateSql: string;
}

const SQLConsole = observer(({ blockUid, allowNormalUser, templateSql }: SQLConsoleProps) => {
  if (allowNormalUser) {
    return <TemplateSQLConsole blockUid={blockUid} templateSql={templateSql} />;
  }
  return <AdminSQLConsole blockUid={blockUid} />;
});

// ─────────────────────────────────────────────
// Block Model
// ─────────────────────────────────────────────

export class SQLConsoleBlockModel extends BlockModel {
  renderComponent() {
    const allowNormalUser = Boolean(this.props.allowNormalUser);
    const templateSql = String(this.props.templateSql || '');
    return <SQLConsole blockUid={this.uid} allowNormalUser={allowNormalUser} templateSql={templateSql} />;
  }
}

// ─────────────────────────────────────────────
// Flow settings
// ─────────────────────────────────────────────

SQLConsoleBlockModel.registerFlow({
  key: 'sqlConsoleSettings',
  title: tExpr('SQL Console Settings'),
  steps: {
    normalUserAccess: {
      title: tExpr('Allow normal users to run'),
      uiSchema: {
        allowNormalUser: {
          type: 'boolean',
          'x-component': 'Checkbox',
          'x-decorator': 'FormItem',
          title: tExpr('Allow normal users to execute SQL'),
          description: tExpr(
            'When enabled, normal users run the saved SQL template via ID. Save the SQL template below.',
          ),
        },
        templateSql: {
          type: 'string',
          'x-component': 'Input.TextArea',
          'x-decorator': 'FormItem',
          title: tExpr('SQL Template'),
          description: tExpr(
            'Use $paramName for user-supplied bind parameters. e.g. SELECT * FROM users WHERE status = $status',
          ),
          'x-component-props': {
            style: { fontFamily: 'monospace', minHeight: 120 },
            placeholder: 'SELECT * FROM users WHERE status = $status',
          },
          'x-reactions': {
            dependencies: ['allowNormalUser'],
            fulfill: {
              state: {
                visible: '{{$deps[0]}}',
              },
            },
          },
        },
      },
      defaultParams(ctx) {
        return {
          allowNormalUser: ctx.model.props.allowNormalUser ?? false,
          templateSql: ctx.model.props.templateSql ?? '',
        };
      },
      async handler(ctx, params) {
        ctx.model.setProps('allowNormalUser', params.allowNormalUser);
        ctx.model.setProps('templateSql', params.templateSql ?? '');

        // If "allow normal user" is enabled and a template SQL was provided, save it
        if (params.allowNormalUser && params.templateSql) {
          try {
            await ctx.api.request({
              url: 'flowSql:save',
              method: 'POST',
              data: {
                uid: ctx.model.uid,
                sql: params.templateSql,
              },
            });
          } catch (error: unknown) {
            console.error('[SQLConsole] Failed to save SQL template:', error);
          }
        }
      },
    },
  },
});

SQLConsoleBlockModel.define({
  hide: false,
  label: 'SQL Console',
});
