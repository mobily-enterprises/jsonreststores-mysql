/*
Copyright (C) 2016 Tony Mobily

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

const Mixin = (superclass) => class extends superclass {
  //
  async transformResult (request, op, recordOrSet) { return null }

  static get connection () { return null }
  static get table () { return null }

  static get positionFilter () { return [] } // List of fields that will determine the subset

  constructor () {
    super()
    const promisify = require('util').promisify

    this.connection = this.constructor.connection
    this.table = this.constructor.table
    this.positionFilter = this.constructor.positionFilter

    this.connection.queryP = promisify(this.connection.query)
  }

  implementInsertSql (joins) {
    const updateString = 'INSERT INTO'
    return `${updateString} \`${this.table}\` SET ?`
  }

  // Input:
  // - request.body
  // Output: an object (saved record)
  //
  // SIDE_EFFECT:
  //   request.record (the loaded record)
  //   request.body[beforeIdField] (beforeId placed back into body so that client gets it)

  async implementInsert (request) {
    this._checkVars()

    await super.implementInsert(request)

    // This uses request.beforeId
    await this._calculatePosition(request)

    // Work out the insert object
    const insertObject = await this.manipulateInsertObject(request, { ...request.body }) // hook

    // Run the query
    const query = await this.implementInsertSql()

    // Perform the update
    // The ID will be in insertResult.insertId
    const insertResult = await this.connection.queryP(query, [insertObject])

    // Make up a bogus request (just with request.params using insertId)
    // to re-fetch the record and return it
    // NOTE: request.params is all implementFetch uses
    const bogusRequest = { options: {}, session: request.session, params: { [this.idProperty]: insertResult.insertId } }
    request.record = await this.implementFetch(bogusRequest)

    // This could be useful to the 'after' hook
    request.insertObject = insertObject

    // After insert: post-processing of the record
    await this.afterInsert(request)

    // Requested by the API
    // implementUpdate() needs to have this in order to restore the
    // previously deleted record.beforeId
    this.restoreBeforeIdInRecord(request)

    return request.record
  }

  implementUpdateSql (joins, conditions) {
    const updateString = 'UPDATE'
    const whereString = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : ''

    return `${updateString} \`${this.table}\` SET ? ${whereString} `
  }

  // Input:
  // - request.params (query)
  // - request.body (data)
  // Output: an object (updated record, refetched)
  // SIDE_EFFECT:
  //   request.originalRecord
  //   request.record (created, if not already set)
  //   request.body[beforeIdField] (beforeId placed back into body so that client gets it)
  //
  async implementUpdate (request) {
    this._checkVars()

    await super.implementUpdate(request)

    // This uses request.beforeId
    await this._calculatePosition(request)

    // Make up the crucial variables for the update: object, joins, and conditions/args
    const updateObject = await this.manipulateUpdateObject(request, { ...request.body }) // hook
    const joins = await this.updateJoins(request) // hook
    let { conditions, args } = await this.updateConditionsAndArgs(request) // hook

    // Add mandatory conditions dictated by the passed params
    const { paramsConditions, paramsArgs } = this._paramsConditions(request)
    conditions = conditions.concat(paramsConditions)
    args = args.concat(paramsArgs)

    // Run the query
    const query = await this.implementUpdateSql(joins, conditions)

    // Perform the update
    await this.connection.queryP(query, [updateObject, ...args])

    // Re-fetch the record and return it
    // NOTE: request.params is all implementFetch uses
    request.originalRecord = request.record
    request.record = await this.implementFetch(request)

    // This could be useful to the 'after' hook
    request.hookResults = { updateObject, joins, conditions, args }

    // After update: post-processing of the record
    await this.afterUpdate(request)

    // Requested by the API
    // implementUpdate() needs to have this in order to restore the
    // previously deleted record.beforeId
    this.restoreBeforeIdInRecord(request)

    return request.record
  }

  implementDeleteSql (tables, joins, conditions) {
    const deleteString = 'DELETE'
    const tablesString = tables.join(',')
    const joinString = joins.join(' ')
    const whereString = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : ''

    return `${deleteString} ${tablesString} FROM \`${this.table}\` ${joinString} ${whereString} `
  }

  // Input: request.params (with key this.idProperty set)
  // Output: nothing
  async implementDelete (request) {
    this._checkVars()

    await super.implementDelete(request)

    // Get different select and different args if available
    const { tables, joins } = await this.deleteTablesAndJoins(request) // hook
    let { conditions, args } = await this.deleteConditionsAndArgs(request) // hook
    const { paramsConditions, paramsArgs } = this._paramsConditions(request) // hook

    // Add mandatory conditions dictated by the passed params
    conditions = conditions.concat(paramsConditions)
    args = args.concat(paramsArgs)

    const query = await this.implementDeleteSql(tables, joins, conditions)

    // Perform the deletion
    await this.connection.queryP(query, args)

    // This could be useful to the 'after' hook
    request.hookResults = { tables, joins, conditions, args }

    // After insert: post-processing of the record
    await this.afterDelete(request)
  }

  // **************************************************
  // HELPER FUNCTIONS NEEDED BY implementQuery()
  // **************************************************

  implementQuerySql (fields, joins, conditions, sort) {
    const selectString = 'SELECT'
    const fieldsString = fields.join(',')
    const joinString = joins.join(' ')
    const whereString = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : ''
    const sortString = sort.length
      ? `ORDER BY ${sort.join(',')}`
      : ''
    const rangeString = 'LIMIT ?, ?'

    return {
      fullQuery: `${selectString} ${fieldsString} FROM \`${this.table}\` ${joinString} ${whereString} ${sortString} ${rangeString}`,
      countQuery: `SELECT COUNT(*) AS grandTotal FROM \`${this.table}\` ${joinString} ${whereString}`
    }
  }

  // Input: request.params, request.options.[conditionsHash,skip,limit,sort]
  // Output: { data: [], grandTotal: ? }
  async implementQuery (request) {
    this._checkVars()

    await super.implementQuery(request)

    // Get different select and different args if available
    const { fields, joins } = await this.queryFieldsAndJoins(request) // hook
    let { conditions, args } = await this.queryConditionsAndArgs(request) // hook
    const { sort, args: sortArgs } = await this.querySort(request) // hook

    // Add mandatory conditions dictated by the passed params
    const { paramsConditions, paramsArgs } = this._paramsConditions(request)
    if (paramsConditions.length) conditions = conditions.concat(paramsConditions)
    if (paramsArgs.length) args = args.concat(paramsArgs)

    // Add positional sort if there is no other sorting required
    if (sort.length === 0 && this.positionField) {
      sort.push(`${this.positionField}`)
    }

    const { fullQuery, countQuery } = await this.implementQuerySql(fields, joins, conditions, sort)

    // Add skip and limit to args
    const argsWithSortAndLimits = [...args, ...sortArgs, request.options.skip, request.options.limit]

    let result = await this.connection.queryP(fullQuery, argsWithSortAndLimits)
    const grandTotal = (await this.connection.queryP(countQuery, args))[0].grandTotal

    // Transform the result it if necessary
    let transformed
    if (result.length) {
      transformed = await this.transformResult(request, 'query', result) // hook
    }
    if (transformed) result = transformed

    return { data: result, grandTotal: grandTotal }
  }

  implementFetchSql (fields, joins, conditions) {
    const selectString = 'SELECT'
    const fieldsString = fields.join(',')
    const joinString = joins.join(' ')
    const whereString = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : ''

    return `${selectString} ${fieldsString} FROM \`${this.table}\` ${joinString} ${whereString} `
  }

  // Input: request.params (with key this.idProperty set)
  // Output: an object
  async implementFetch (request) {
    this._checkVars()

    await super.implementFetch(request)

    // Get different select and different args if available
    const { fields, joins } = await this.fetchFieldsAndJoins(request) // hook
    let { conditions, args } = await this.fetchConditionsAndArgs(request) // hook

    // Add mandatory conditions dictated by the passed params
    const { paramsConditions, paramsArgs } = this._paramsConditions(request)
    conditions = conditions.concat(paramsConditions)
    args = args.concat(paramsArgs)

    const query = await this.implementFetchSql(fields, joins, conditions)

    // Get the result
    const records = await this.connection.queryP(query, args)

    // Get the record
    request.record = records[0]

    // Requested by the API: when implementing implementFetch(), this function
    // must be called when request.record is set
    this.implementFetchPermissions(request)

    // Transform the record if necessary
    let transformed
    let record = request.record
    if (record) transformed = await this.transformResult(request, 'fetch', request.record) // hook
    if (transformed) record = transformed

    return record
  }

  // ********************************************************************
  // HELPER FUNCTIONS
  // ********************************************************************

  // Make sure the positionField is updated depending on beforeID passed:
  // undefined    => leave it where it was (if it had a position) or place it last (if it didn't have a position)
  // null         => place it last
  // number       => valid record   => place it before that record, "making space"
  //              => INvalid record => place it last
  //
  // SIDE_EFFECT: body[this.positionField]
  async _calculatePosition (request) {
    //
    //
    /*
    // Currently unused
    const _positionFiltersFieldsSame = (request) => {
      // If there is no original request.record, there is nothing to check
      if (!request.record) return true

      // Check whether the positionFilter fields have changed.
      // Note that it's a soft `!=` comparison since the way data is stored on the DB
      // might be different to what is passed. This assumes that DB and JS will have
      // compatible results
      for (const k of this.positionFilter) {
        if (typeof request.body[k] !== 'undefined' && typeof request.record[k] !== 'undefined') {
          if (request.body[k] != request.record[k]) return false // eslint-disable-line
        }
      }
      return true
    }
    */

    // This function will be called a lot in case the record is to be placed last.
    // It has side-effects (it changes request.body AND it changes the DB)
    const last = async () => {
      request.body[this.positionField] = (await this.connection.queryP(`SELECT max(${this.positionField}) as maxPosition FROM ${this.table} WHERE ${wherePositionFilter}`, positionQueryArgs))[0].maxPosition + 1
      request.beforeId = null
    }

    // No position field: exit right away
    if (!this.positionField) return

    // The user is manually setting a position, which should be allowed
    if (typeof request.body[this.positionField] !== 'undefined') return

    // Work really hard to find out what the previous position was
    // Note: request.record might be empty even in case of update in case
    // of usage via API (implementUpdate() with dummy/incomplete request)
    let prevPosition
    if (request.record) prevPosition = request.record[this.positionField]
    else {
      if (request.params && typeof request.params[this.idProperty] !== 'undefined') {
        const r = (await this.connection.queryP(`SELECT ${this.positionField} FROM ${this.table} WHERE ${this.table}.${this.idProperty} = ?`, [request.params[this.idProperty]]))[0]
        if (r) prevPosition = r[this.positionField]
      }
    }

    const positionQueryArgs = []
    let wherePositionFilter
    if (this.positionFilter.length === 0) wherePositionFilter = '1 = 1'
    else {
      const source = { ...request.record, ...request.body }
      const r = []
      for (const k of this.positionFilter) {
        if (source[k] === null || typeof source[k] === 'undefined') {
          r.push(`(${k} is NULL)`)
        } else {
          r.push(`(${k} = ?)`)
          positionQueryArgs.push(source[k])
        }
      }
      wherePositionFilter = ' ' + r.join(' AND ') + ' '
    }

    // If ANY of the positionFilters have changed, it will go
    // last, end of story (since "position 2" might mean something different)
    //
    // This is because generally proper repositioning will only happen with Drag&drop and
    // therefore changing positio fields would be strange.
    // On the other hand, if a field is soft-deleted, it will need to have its
    // place reset since its position makes no sense in the new "group"

    // DELETED since an element might be repositioned to a new group, DOH!
    // if (!_positionFiltersFieldsSame(request)) {
    //   await last()
    // }

    // undefined    => leave it where it was (if it had a position) or place it last (if it didn't have a position)
    if (typeof request.beforeId === 'undefined') {
      if (!prevPosition) await last()
      else request.body[this.positionField] = prevPosition

    // null         => place it last
    } else if (request.beforeId === null) {
      await last()

    // number       => valid record   => place it before that record, overwriting previous position
    //                 Invalid record => place it last
    } else {
      const beforeIdItem = (await this.connection.queryP(`SELECT ${this.table}.${this.idProperty}, ${this.positionField} FROM ${this.table} WHERE ${this.table}.${this.idProperty} = ? AND ${wherePositionFilter}`, [request.beforeId, ...positionQueryArgs]))[0]

      // number       => valid record   => place it before that record, "making space"
      if (beforeIdItem) {
        await this.connection.queryP(`UPDATE ${this.table} SET ${this.positionField} = ${this.positionField} + 1 WHERE ${this.positionField} >= ?  AND ${wherePositionFilter} ORDER BY ${this.positionField} DESC`, [beforeIdItem[this.positionField] || 0, ...positionQueryArgs])
        request.body[this.positionField] = beforeIdItem[this.positionField]
      //              => INvalid record => place it last
      } else {
        await last()
      }
    }
  }

  _checkVars () {
    if (!this.connection) throw new Error('The static property "connection" must be set')
    if (!this.table) throw new Error('The static property "table" must be set')
  }

  _paramsConditions (request) {
    const paramsConditions = []
    const paramsArgs = []

    for (const param in request.params) {
      paramsConditions.push(`\`${this.table}\`.\`${param}\` = ?`)
      paramsArgs.push(request.params[param])
    }

    return { paramsConditions, paramsArgs }
  }

  schemaFields () {
    const l = []

    // Return all fields from the schema that are not marked as "silent"
    for (const k in this.schema.structure) {
      // Skip fields marked as "silent" in schema
      if (this.schema.structure[k].silent) continue

      // Add field with table name, and correct escaping
      l.push(`\`${this.table}\`.\`${k}\``)
    }
    return l
  }

  // *********************************
  // *** HOOKS
  // *********************************

  fetchConditionsAndArgs (request) {
    return { conditions: [], args: [] }
  }

  fetchFieldsAndJoins (request) {
    return {
      fields: this.commonFields(request, 'fetch'),
      joins: this.commonJoins(request, 'fetch')
    }
  }

  queryFieldsAndJoins (request) {
    return {
      fields: this.commonFields(request, 'query'),
      joins: this.commonJoins(request, 'query')
    }
  }

  commonFields (request) {
    return this.schemaFields()
  }

  commonJoins (request) {
    return []
  }

  manipulateUpdateObject (request, updateObject) {
    return updateObject
  }

  updateConditionsAndArgs (request) {
    return { conditions: [], args: [] }
  }

  updateJoins (request) {
    return []
  }

  // INPUT: request.record
  // OUTPUT: Modify request.record before modifying it, and run any
  // SIDE_EFFECT: insert/updates to other tables if necessary
  afterUpdate (request) {
  }

  manipulateInsertObject (request, insertObject) {
    return insertObject
  }

  afterInsert (request) {
  }

  deleteConditionsAndArgs (request) {
    return { conditions: [], args: [] }
  }

  deleteTablesAndJoins (request) {
    return {
      tables: [this.table],
      joins: []
    }
  }

  afterDelete (request) {
  }

  queryConditionsAndArgs (request) {
    return this.optionsQueryConditionsAndArgs(request)
  }

  querySort (request) {
    return this.optionsSort(request)
  }

  // **************************************************
  // UTIITY FUNCTIONS FOR HOOKS
  // **************************************************

  expandSortField (field) {
    if (!field.includes('.')) return `${this.table}.${field}`
    return field
  }

  optionsSort (request) {
    const optionsSort = request.options.sort
    const sort = []
    const args = []
    if (Object.keys(optionsSort).length) {
      for (const k in optionsSort) {
        sort.push(`${this.expandSortField(k)} ${Number(optionsSort[k]) === 1 ? 'DESC' : 'ASC'}`)
      }
    }
    return { sort, args }
  }

  optionsQueryConditionsAndArgs (request) {
    const conditions = []
    const args = []

    const ch = request.options.conditionsHash

    for (const k in ch) {
      const tEsc = `\`${this.table}\``
      const kEsc = `\`${k}\``
      // Add fields that are in the searchSchema
      const sss = this.searchSchema.structure[k]
      const ss = this.schema.structure[k]
      if (sss && ss && String(ch[k]) !== '') {
        if (ch[k] === null) {
          conditions.push(`${tEsc}.${kEsc} IS NULL`)
        } else {
          if (ss.fullSearch || sss.fullSearch) {
            conditions.push(`${tEsc}.${kEsc} LIKE ?`)
            args.push('%' + ch[k] + '%')
          } else {
            conditions.push(`${tEsc}.${kEsc} = ?`)
            args.push(ch[k])
          }
        }
      }
    }

    return { conditions, args }
  }

  // ***************************
  // *** SCHEMA SYNC FUNCTION
  // ***************************

  // Synchronise store schema definition to DB
  async schemaDbSync () {
    function makeSqlDefinition (columnName) {
      const field = this.schema.structure[columnName]
      let sqlType
      let trim = 256
      if (field.dbType) sqlType = field.dbType
      else {
        switch (field.type) {
          case 'number':
          case 'id':
            if (field.float) sqlType = 'FLOAT'
            else sqlType = 'INT'
            break
          case 'string':
            if (field.trim) trim = field.trim
            sqlType = `VARCHAR(${trim})`
            break
          case 'boolean':
            sqlType = 'TINYINT'
            break
          case 'date':
            sqlType = 'DATE'
            break
          case 'timestamp':
            sqlType = 'TIMESTAMP'
            break
          case 'blob':
            sqlType = 'BLOB'
            break
          default:
            throw new Error(`${field.type} not converted automatically. Use dbType instead`)
        }
      }

      // NULL clause
      const nullOrNotNull = field.canBeNull ? 'NULL' : 'NOT NULL'

      // Default value, giving priority to dbDefault
      let defaultValue
      if (typeof field.dbDefault !== 'undefined') defaultValue = `DEFAULT '${field.dbDefault}'`
      else if (typeof field.default !== 'undefined') defaultValue = `DEFAULT '${field.default}'`
      else defaultValue = ''

      // AUTO_INCREMENT clause
      return `\`${columnName}\` ${sqlType} ${nullOrNotNull} ${defaultValue}`
    }

    async function maybeChangePrimaryKey (primaryKeyColumn) {
      //
      // If the primary key hasn't changed, don't do anything
      if (primaryKeyColumn && primaryKeyColumn.COLUMN_NAME === this.idProperty) {
        return
      }

      // ID column has changed. This is a tricky situation, especially because of
      // auto_increment which will get in the way
      const oldPrimaryKeyColumnName = primaryKeyColumn.COLUMN_NAME

      // First of all, if the OLD primary key has AUTO_INCREMENT, then
      // AUTO_INCREMENT must be taken out
      if (primaryKeyColumn.EXTRA === 'auto_increment') {
        await this.connection.queryP('SET foreign_key_checks = 0')
        const pkc = primaryKeyColumn
        const defWithoutAutoIncrement = `${pkc.COLUMN_NAME} ${pkc.COLUMN_TYPE} ${pkc.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'} ${typeof pkc.COLUMN_DEFAULT !== 'undefined' && pkc.COLUMN_KEY !== 'PRI' ? 'DEFAULT ' + pkc.COLUMN_DEFAULT : ''}`
        await this.connection.queryP(`ALTER TABLE \`${this.table}\` CHANGE \`${oldPrimaryKeyColumnName}\` ${defWithoutAutoIncrement}`)
        await this.connection.queryP('SET foreign_key_checks = 1')
      }

      // Check that there are INDEXES available for the "old" id
      // This is crucial since the next statement, DROP PRIMARY KEY, ADD PRIMARY_KEY
      // will fail if the field is still being referenced in the DB and
      // it's left without key
      const indexIsThere = await this.connection.queryP(`SHOW INDEX FROM \`${this.table}\` WHERE Key_name <> 'PRIMARY' AND Seq_in_index = 1 AND Column_name='${oldPrimaryKeyColumnName}'`)
      if (!indexIsThere.length) {
        const dbIndex = schemaFieldsAsArray.find(definition => definition.name === this.idProperty).dbIndex || `jrs_${oldPrimaryKeyColumnName}`
        await this.connection.queryP(`ALTER TABLE \`${this.table}\` ADD INDEX \`${dbIndex}\`(\`${oldPrimaryKeyColumnName}\`)`)
      }

      // Drop the old primary key, and add the new primary key
      await this.connection.queryP(`ALTER TABLE \`${this.table}\` DROP PRIMARY KEY, ADD PRIMARY KEY (\`${this.idProperty}\`)`)
      return true
    }

    const tableAlreadyExists = (await this.connection.queryP(`SHOW TABLES like '${this.table}'`)).length
    if (!tableAlreadyExists) await this.connection.queryP(`CREATE TABLE \`${this.table}\` (__dummy__ INT(1) )`)

    const columns = await this.connection.queryP(`SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE table_name = '${this.table}'`)
    const indexes = await this.connection.queryP(`SHOW index FROM \`${this.table}\``)
    const constraints = await this.connection.queryP(`SELECT * from INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = '${this.table}'`)
    // select * from information_schema.table_constraints where constraint_schema = 'sasit-development';

    // Make a hash of all columns
    const columnsHash = columns.reduce((map, column) => {
      map[column.COLUMN_NAME] = column
      return map
    }, {})

    const primaryKeyColumn = columns.find(el => el.COLUMN_KEY === 'PRI')

    // Turn the schema fields into a searchable array. It will be used as an
    // array to search for the auto-increment field, and to iterate through it
    const schemaFieldsAsArray = Object.keys(this.schema.structure).map(k => ({ ...this.schema.structure[k], name: k }))

    // Work out which one the auto_increment field will be
    let autoIncrementField = schemaFieldsAsArray.find(el => el.autoIncrement)
    if (!autoIncrementField) autoIncrementField = schemaFieldsAsArray.find(el => el.name === this.idProperty)
    const autoIncrementFieldName = autoIncrementField.name

    // This is important in case the primary key has changed
    if (primaryKeyColumn) await maybeChangePrimaryKey.call(this, primaryKeyColumn)

    const dbIndexes = []
    const dbConstraints = []
    for (let i = 0, l = schemaFieldsAsArray.length; i < l; i++) {
      const field = schemaFieldsAsArray[i]

      const creatingNewColumn = !columnsHash[field.name]

      const changeOrAddStatement = creatingNewColumn ? 'ADD COLUMN' : `CHANGE \`${field.name}\``

      const def = makeSqlDefinition.call(this, field.name)
      // If it's a new table, and it's the primary key column, then it's already going to be
      // auto_increment. So, it must be defined as primary key
      const maybePrimaryKey = (creatingNewColumn && field.name === this.idProperty) ? 'PRIMARY KEY' : ''
      const maybeAutoIncrement = autoIncrementFieldName === field.name ? 'AUTO_INCREMENT' : ''
      const maybeAfter = i ? `AFTER \`${schemaFieldsAsArray[i - 1].name}\`` : ''

      const sqlQuery = `ALTER TABLE \`${this.table}\` ${changeOrAddStatement} ${def} ${maybePrimaryKey} ${maybeAutoIncrement} ${maybeAfter}`

      await this.connection.queryP(sqlQuery)

      // For searchable and dbIndex fields, add an index
      if (field.dbIndex || field.searchable) {
        if (columnsHash[field.name] && field.name !== this.idProperty) {
          dbIndexes.push({
            column: field.name,
            unique: field.dbUnique,
            name: field.dbIndexName
          })
        }
      }

      if (field.dbConstraint) {
        const dbc = field.dbConstraint
        dbConstraints.push({
          source: field.name,
          table: dbc.table,
          store: dbc.store,
          column: dbc.column,
          name: dbc.name
        })
      }
    }

    // Add anything listed in dbExtraIndexes in the list of possible
    // indexes to all
    if (this.dbExtraIndexes) {
      for (let i = 0, l = this.dbExtraIndexes.length; i < l; i++) {
        const ei = this.dbExtraIndexes[i]
        dbIndexes.push({
          column: ei.column,
          unique: !ei.unique,
          name: ei.name
        })
      }
    }

    // If it's a newly created table, delete the dummy column
    if (columnsHash.__dummy__) await this.connection.queryP(`ALTER TABLE \`${this.table}\` DROP COLUMN \`__dummy__\``)

    // Add db indexes
    for (let i = 0, l = dbIndexes.length; i < l; i++) {
      const dbi = dbIndexes[i]

      // Handle multiple columns
      let columns
      if (!Array.isArray(dbi.column)) columns = `\`${dbi.column}\``
      else columns = dbi.column.map(c => '`' + c + '`').join(',')

      // Make up an index name if needed
      let indexName
      if (dbi.dbIndexName) indexName = dbi.dbIndexName
      else {
        if (!Array.isArray(dbi.column)) indexName = `jrs_${dbi.column}`
        else indexName = 'jrs_' + dbi.column.join('_')
      }

      // If the index already exists, don't do anything
      if (indexes.find(i => i.Key_name === indexName)) continue

      const sqlQuery = `ALTER TABLE \`${this.table}\` ADD ${dbi.unique ? 'UNIQUE' : ''} INDEX \`${indexName}\` (${columns})`
      await this.connection.queryP(sqlQuery)
    }

    // Add db constraints
    for (let i = 0, l = dbConstraints.length; i < l; i++) {
      const dbc = dbConstraints[i]

      let table
      let column
      let name

      if (dbc.table) table = dbc.table
      else if (dbc.store) table = this.stores[dbc.store].table

      if (dbc.column) column = dbc.column
      else column = this.stores[dbc.store].idProperty

      if (dbc.name) name = dbc.name
      else name = `jrs_${dbc.source}_to_${table}_${column}`

      if (constraints.find(c => c.CONSTRAINT_NAME === name)) return

      const sqlQuery = `
      ALTER TABLE \`${this.table}\`
      ADD CONSTRAINT \`${name}\`
      FOREIGN KEY (\`${dbc.source}\`)
      REFERENCES \`${table}\` (\`${column}\`)
        ON DELETE NO ACTION
        ON UPDATE NO ACTION`

      await this.connection.queryP(sqlQuery)
    }
  }
}

exports = module.exports = Mixin
