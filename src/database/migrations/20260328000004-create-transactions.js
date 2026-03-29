"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Transactions", {
      id: {
        type: Sequelize.CHAR(36),
        primaryKey: true,
        allowNull: false,
      },
      type: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      amount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
      },
      date: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      categoryId: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: {
          model: "Categories",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      description: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      fromAccountId: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: {
          model: "Accounts",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      toAccountId: {
        type: Sequelize.CHAR(36),
        allowNull: true,
        references: {
          model: "Accounts",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      userId: {
        type: Sequelize.CHAR(36),
        allowNull: false,
        references: {
          model: "Users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      tags: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      note: {
        type: Sequelize.STRING(1000),
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Transactions");
  },
};
