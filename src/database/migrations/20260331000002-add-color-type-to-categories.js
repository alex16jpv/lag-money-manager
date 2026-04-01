"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Categories", "color", {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.addColumn("Categories", "type", {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Categories", "type");
    await queryInterface.removeColumn("Categories", "color");
  },
};
