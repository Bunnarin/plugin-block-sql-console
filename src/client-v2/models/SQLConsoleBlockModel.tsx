import React, { useState } from 'react';
import { BlockModel, CodeEditor } from '@nocobase/client-v2';
import { observer, useFlowContext, tExpr } from '@nocobase/flow-engine';
import { Card, Button, Table, Modal, message, Typography } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';

const SQLConsole = observer((props: any) => {
  const ctx = useFlowContext();
  const [sql, setSql] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [affectedCount, setAffectedCount] = useState<number | null>(null);
  const [pendingSql, setPendingSql] = useState<string | null>(null);

  const getCountQuery = (sqlText: string): string | null => {
    const trimmed = sqlText.trim().replace(/\s+/g, ' ');
    
    // Check for UPDATE
    const updateMatch = trimmed.match(/^UPDATE\s+([a-zA-Z0-9_"]+)\s+SET\s+(.*?)(\s+WHERE\s+.*)?$/i);
    if (updateMatch) {
      const tableName = updateMatch[1];
      const whereClause = updateMatch[3] || '';
      return `SELECT count(*) as count FROM ${tableName}${whereClause}`;
    }
    
    // Check for DELETE
    const deleteMatch = trimmed.match(/^DELETE\s+FROM\s+([a-zA-Z0-9_"]+)(\s+WHERE\s+.*)?$/i);
    if (deleteMatch) {
      const tableName = deleteMatch[1];
      const whereClause = deleteMatch[2] || '';
      return `SELECT count(*) as count FROM ${tableName}${whereClause}`;
    }
    
    return null;
  };

  const executeSql = async (sqlToExecute: string) => {
    setLoading(true);
    try {
      const res = await ctx.api.request({
        url: 'flowSql:run',
        method: 'POST',
        data: {
          sql: sqlToExecute,
          type: 'selectRows',
        },
      });

      const data = res.data?.data;
      if (Array.isArray(data) && data.length > 0) {
        const firstRow = data[0];
        const newColumns = Object.keys(firstRow).map((key) => ({
          title: key,
          dataIndex: key,
          key: key,
        }));
        setColumns(newColumns);
        setResults(data);
      } else {
        setColumns([]);
        setResults([]);
        message.success('Execution completed, no rows returned.');
      }
    } catch (error: any) {
      message.error(error.response?.data?.error?.message || error.message || 'Execution failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRun = async () => {
    if (!sql.trim()) {
      message.warning('Please enter a SQL query');
      return;
    }

    const isModifyQuery = /^(UPDATE|DELETE)/i.test(sql.trim());
    if (isModifyQuery) {
      const countQuery = getCountQuery(sql);
      if (countQuery) {
        setLoading(true);
        try {
          const res = await ctx.api.request({
            url: 'flowSql:run',
            method: 'POST',
            data: {
              sql: countQuery,
              type: 'selectVar',
            },
          });
          
          setAffectedCount(Number(res.data?.data) || 0);
          setPendingSql(sql);
          setConfirmModalVisible(true);
        } catch (error: any) {
          message.error('Failed to get affected rows count: ' + (error.response?.data?.error?.message || error.message));
        } finally {
          setLoading(false);
        }
      } else {
        // Fallback if regex fails to parse
        setAffectedCount(null);
        setPendingSql(sql);
        setConfirmModalVisible(true);
      }
    } else {
      executeSql(sql);
    }
  };

  const handleConfirmRun = () => {
    setConfirmModalVisible(false);
    if (pendingSql) {
      executeSql(pendingSql);
      setPendingSql(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%', minHeight: '400px' }}>
      <div style={{ height: '200px', border: '1px solid #d9d9d9', borderRadius: '2px' }}>
        <CodeEditor
          language="sql"
          value={sql}
          onChange={(value) => setSql(value || '')}
          height="100%"
        />
      </div>
      <div>
        <Button 
          type="primary" 
          icon={<PlayCircleOutlined />} 
          onClick={handleRun}
          loading={loading}
        >
          Run SQL
        </Button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Table 
          columns={columns} 
          dataSource={results.map((row, i) => ({ ...row, key: i }))} 
          pagination={false}
          size="small"
          scroll={{ x: 'max-content' }}
        />
      </div>

      <Modal
        title="Confirm Execution"
        open={confirmModalVisible}
        onOk={handleConfirmRun}
        onCancel={() => setConfirmModalVisible(false)}
        okText="Execute"
        okButtonProps={{ danger: true }}
      >
        <Typography.Text>
          You are about to execute a data modification query (UPDATE/DELETE).
        </Typography.Text>
        <div style={{ marginTop: 16 }}>
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
    </div>
  );
});

export class SQLConsoleBlockModel extends BlockModel {
  onInit(options: any): void {
    super.onInit(options);
  }

  renderComponent() {
    return (
      <Card title={this.title} bordered={false} bodyStyle={{ height: 'calc(100% - 58px)' }}>
        <SQLConsole />
      </Card>
    );
  }
}

SQLConsoleBlockModel.registerFlow({
  key: 'cardSettings',
  title: tExpr('Card settings'),
  steps: {
    titleDescription: {
      title: tExpr('Title & description'),
      uiSchema: {
        title: {
          'x-component': 'Input',
          'x-decorator': 'FormItem',
          title: tExpr('Title'),
        },
        description: {
          'x-component': 'Input.TextArea',
          'x-decorator': 'FormItem',
          title: tExpr('Description'),
        },
      },
      handler(ctx, params) {
        const title = ctx.t(params.title);
        const description = ctx.t(params.description);
        ctx.model.setDecoratorProps({ title, description });
      },
    },
  },
});

SQLConsoleBlockModel.define({
  hide: false,
  label: 'SQL Console',
});
